use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, String, Vec};

use crate::errors::Error;

#[contracttype]
#[derive(Clone)]
pub struct VaccinationCredential {
    pub patient_id: u64,
    pub issuer: Address,
    pub vaccine_type: String,
    pub dose_number: u32,
    pub total_doses: u32,
    pub lot_number: String,
    pub administered_at: u64,
    pub expiry_date: u64,
    pub proof_hash: BytesN<32>,
    pub zk_proof: BytesN<32>,
    pub status: VaccinationStatus,
    pub verified: bool,
    pub verified_at: u64,
    pub verifier: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaccinationStatus {
    Pending,
    Valid,
    Expired,
    Revoked,
    Invalid,
}

#[contracttype]
pub enum VaccinationEvent {
    CredentialSubmitted(u64, u64, u64),
    ProofVerified(u64, Address, u64),
    StatusChanged(u64, VaccinationStatus, VaccinationStatus, u64),
    CredentialRevoked(u64, String, u64),
}

#[contracttype]
pub enum VaccinationDataKey {
    Counter,
    Credential(u64),
    PatientIndex(u64),
    RevokedList,
    VerifierWhitelist,
}

const PERSISTENT_TTL_THRESHOLD: u32 = 17_280;
const PERSISTENT_TTL_EXTEND: u32 = 535_680;
const INSTANCE_TTL_THRESHOLD: u32 = 17_280;
const INSTANCE_TTL_EXTEND: u32 = 535_680;

#[contract]
pub struct VaccinationVerification;

#[contractimpl]
impl VaccinationVerification {
    #[allow(clippy::too_many_arguments)]
    pub fn submit_credential(
        env: &Env,
        issuer: Address,
        patient_id: u64,
        vaccine_type: String,
        dose_number: u32,
        total_doses: u32,
        lot_number: String,
        administered_at: u64,
        expiry_date: u64,
        proof_hash: BytesN<32>,
        zk_proof: BytesN<32>,
    ) -> Result<u64, Error> {
        issuer.require_auth();

        if dose_number == 0 || dose_number > total_doses {
            return Err(Error::InvalidImplementation);
        }

        let credential_id = next_credential_id(env);

        let credential = VaccinationCredential {
            patient_id,
            issuer: issuer.clone(),
            vaccine_type,
            dose_number,
            total_doses,
            lot_number,
            administered_at,
            expiry_date,
            proof_hash,
            zk_proof,
            status: VaccinationStatus::Pending,
            verified: false,
            verified_at: 0,
            verifier: issuer,
        };

        write_credential(env, credential_id, &credential);

        let index_key = VaccinationDataKey::PatientIndex(patient_id);
        env.storage().persistent().set(&index_key, &credential_id);
        bump_persistent(env, &index_key);

        env.events().publish(
            (String::from_str(env, "vax_submit"), credential_id),
            VaccinationEvent::CredentialSubmitted(
                credential_id,
                patient_id,
                env.ledger().timestamp(),
            ),
        );

        Ok(credential_id)
    }

    pub fn verify_credential(
        env: &Env,
        credential_id: u64,
        verifier: Address,
    ) -> Result<bool, Error> {
        verifier.require_auth();

        Self::check_verifier_authorized(env, &verifier)?;

        let mut credential = read_credential(env, credential_id)?;

        if credential.status == VaccinationStatus::Revoked {
            return Err(Error::CredentialRevoked);
        }

        let proof_valid =
            Self::validate_zk_proof(env, &credential.zk_proof, &credential.proof_hash);

        if !proof_valid {
            credential.status = VaccinationStatus::Invalid;
            write_credential(env, credential_id, &credential);

            env.events().publish(
                (String::from_str(env, "vax_status"), credential_id),
                VaccinationEvent::StatusChanged(
                    credential_id,
                    VaccinationStatus::Pending,
                    VaccinationStatus::Invalid,
                    env.ledger().timestamp(),
                ),
            );

            return Ok(false);
        }

        let now = env.ledger().timestamp();
        if credential.expiry_date > 0 && now > credential.expiry_date {
            credential.status = VaccinationStatus::Expired;
            write_credential(env, credential_id, &credential);

            env.events().publish(
                (String::from_str(env, "vax_status"), credential_id),
                VaccinationEvent::StatusChanged(
                    credential_id,
                    VaccinationStatus::Pending,
                    VaccinationStatus::Expired,
                    now,
                ),
            );

            return Ok(false);
        }

        credential.status = VaccinationStatus::Valid;
        credential.verified = true;
        credential.verified_at = now;
        credential.verifier = verifier.clone();

        write_credential(env, credential_id, &credential);

        env.events().publish(
            (String::from_str(env, "vax_verify"), credential_id),
            VaccinationEvent::ProofVerified(credential_id, verifier, now),
        );

        Ok(true)
    }

    pub fn check_vaccination_status(
        env: &Env,
        credential_id: u64,
    ) -> Result<VaccinationStatus, Error> {
        let credential = read_credential(env, credential_id)?;

        if credential.status == VaccinationStatus::Valid {
            let now = env.ledger().timestamp();
            if credential.expiry_date > 0 && now > credential.expiry_date {
                return Ok(VaccinationStatus::Expired);
            }
        }

        Ok(credential.status)
    }

    pub fn is_fully_vaccinated(env: &Env, patient_id: u64) -> Result<bool, Error> {
        let index_key = VaccinationDataKey::PatientIndex(patient_id);
        let credential_id: u64 = env
            .storage()
            .persistent()
            .get(&index_key)
            .ok_or(Error::VerificationNotFound)?;
        bump_persistent(env, &index_key);

        let credential = read_credential(env, credential_id)?;

        Ok(credential.dose_number >= credential.total_doses
            && credential.status == VaccinationStatus::Valid)
    }

    pub fn revoke_credential(
        env: &Env,
        credential_id: u64,
        issuer: Address,
        reason: String,
    ) -> Result<(), Error> {
        issuer.require_auth();

        let mut credential = read_credential(env, credential_id)?;

        if credential.issuer != issuer {
            return Err(Error::Unauthorized);
        }

        let old_status = credential.status.clone();
        credential.status = VaccinationStatus::Revoked;
        write_credential(env, credential_id, &credential);

        let mut revoked_list: Vec<u64> = env
            .storage()
            .persistent()
            .get(&VaccinationDataKey::RevokedList)
            .unwrap_or(Vec::new(env));

        revoked_list.push_back(credential_id);
        env.storage()
            .persistent()
            .set(&VaccinationDataKey::RevokedList, &revoked_list);
        bump_persistent(env, &VaccinationDataKey::RevokedList);

        env.events().publish(
            (String::from_str(env, "vax_revoke"), credential_id),
            VaccinationEvent::CredentialRevoked(credential_id, reason, env.ledger().timestamp()),
        );

        env.events().publish(
            (String::from_str(env, "vax_status"), credential_id),
            VaccinationEvent::StatusChanged(
                credential_id,
                old_status,
                VaccinationStatus::Revoked,
                env.ledger().timestamp(),
            ),
        );

        Ok(())
    }

    pub fn get_credential(env: &Env, credential_id: u64) -> Result<VaccinationCredential, Error> {
        read_credential(env, credential_id)
    }

    pub fn get_credential_by_patient(env: &Env, patient_id: u64) -> Result<u64, Error> {
        let index_key = VaccinationDataKey::PatientIndex(patient_id);
        let credential_id: u64 = env
            .storage()
            .persistent()
            .get(&index_key)
            .ok_or(Error::VerificationNotFound)?;
        bump_persistent(env, &index_key);
        Ok(credential_id)
    }

    pub fn authorize_verifier(env: &Env, admin: Address, verifier: Address) -> Result<(), Error> {
        admin.require_auth();

        let mut whitelist: Vec<Address> = env
            .storage()
            .persistent()
            .get(&VaccinationDataKey::VerifierWhitelist)
            .unwrap_or(Vec::new(env));

        whitelist.push_back(verifier);
        env.storage()
            .persistent()
            .set(&VaccinationDataKey::VerifierWhitelist, &whitelist);
        bump_persistent(env, &VaccinationDataKey::VerifierWhitelist);

        Ok(())
    }

    fn validate_zk_proof(env: &Env, zk_proof: &BytesN<32>, proof_hash: &BytesN<32>) -> bool {
        let proof_bytes: Bytes = zk_proof.into();
        let computed_hash = env.crypto().sha256(&proof_bytes);
        let hash_bytes: BytesN<32> = computed_hash.into();
        &hash_bytes == proof_hash
    }

    fn check_verifier_authorized(env: &Env, verifier: &Address) -> Result<(), Error> {
        let whitelist: Vec<Address> = env
            .storage()
            .persistent()
            .get(&VaccinationDataKey::VerifierWhitelist)
            .unwrap_or(Vec::new(env));

        if whitelist.is_empty() {
            return Ok(());
        }

        for addr in whitelist.iter() {
            if addr == *verifier {
                return Ok(());
            }
        }

        Err(Error::Unauthorized)
    }
}

fn next_credential_id(env: &Env) -> u64 {
    let id = env
        .storage()
        .instance()
        .get::<_, u64>(&VaccinationDataKey::Counter)
        .unwrap_or(0u64)
        + 1;
    env.storage()
        .instance()
        .set(&VaccinationDataKey::Counter, &id);
    bump_instance(env);
    id
}

fn read_credential(env: &Env, credential_id: u64) -> Result<VaccinationCredential, Error> {
    let key = VaccinationDataKey::Credential(credential_id);
    let credential: VaccinationCredential = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::VerificationNotFound)?;
    bump_persistent(env, &key);
    Ok(credential)
}

fn write_credential(env: &Env, credential_id: u64, credential: &VaccinationCredential) {
    let key = VaccinationDataKey::Credential(credential_id);
    env.storage().persistent().set(&key, credential);
    bump_persistent(env, &key);
}

fn bump_persistent(env: &Env, key: &VaccinationDataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
}
