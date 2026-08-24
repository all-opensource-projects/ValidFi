use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, String, Vec};

use crate::errors::Error;

#[contracttype]
#[derive(Clone)]
pub struct VerificationRecord {
    pub identity_id: u64,
    pub verifier: Address,
    pub proof_hash: BytesN<32>,
    pub verification_commitment: BytesN<32>,
    pub status: String,
    pub created_at: u64,
    pub revoked: bool,
    pub revoked_at: u64,
    pub revocation_reason: String,
}

#[contracttype]
pub enum VerificationEvent {
    Approved,
    Rejected,
    Revoked,
    Validated(bool),
}

/// Typed storage keys.
///
/// Per-credential entries (`Record`, `IdentityIndex`, `RejectReason`) and the
/// `RevokedList` live in **persistent** storage so that each operation only
/// reads and writes its own entry. They were previously kept in *instance*
/// storage, which serialises the contract's entire data set on every call and
/// therefore made each credential operation cost grow linearly with the total
/// number of stored credentials (O(n) per op, O(n²) overall). See
/// `docs/PERFORMANCE.md` and the `benchmarks` module for the measured impact.
///
/// Only the monotonic `Counter` remains in instance storage — it is a single,
/// bounded value that every `submit_proof` must touch anyway.
#[contracttype]
pub enum DataKey {
    Counter,
    Record(u64),
    IdentityIndex(u64),
    RejectReason(u64),
    RevokedList,
}

// Persistent-entry time-to-live, expressed in ledgers (~5s each on Stellar).
// Entries are extended back up to ~31 days whenever they are read or written so
// active credentials are not archived out from under their owners.
const PERSISTENT_TTL_THRESHOLD: u32 = 17_280; // ~1 day
const PERSISTENT_TTL_EXTEND: u32 = 535_680; // ~31 days

// Instance-entry TTL (only holds the bounded counter).
const INSTANCE_TTL_THRESHOLD: u32 = 17_280; // ~1 day
const INSTANCE_TTL_EXTEND: u32 = 535_680; // ~31 days

#[contract]
pub struct Verification;

#[contractimpl]
impl Verification {
    pub fn submit_proof(
        env: &Env,
        identity_id: u64,
        verifier: Address,
        proof_hash: BytesN<32>,
        verification_commitment: BytesN<32>,
    ) -> u64 {
        verifier.require_auth();

        let verification_id = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::Counter)
            .unwrap_or(0u64)
            + 1;

        let record = VerificationRecord {
            identity_id,
            verifier: verifier.clone(),
            proof_hash,
            verification_commitment,
            status: String::from_str(env, "pending"),
            created_at: env.ledger().timestamp(),
            revoked: false,
            revoked_at: 0,
            revocation_reason: String::from_str(env, ""),
        };

        env.storage()
            .instance()
            .set(&DataKey::Counter, &verification_id);
        bump_instance(env);

        write_record(env, verification_id, &record);

        let index_key = DataKey::IdentityIndex(identity_id);
        env.storage().persistent().set(&index_key, &verification_id);
        bump_persistent(env, &index_key);

        verification_id
    }

    pub fn approve_verification(env: &Env, verification_id: u64) -> Result<(), Error> {
        let mut record = read_record(env, verification_id)?;

        record.verifier.require_auth();
        record.status = String::from_str(env, "approved");

        write_record(env, verification_id, &record);

        env.events().publish(
            (String::from_str(env, "approval"), verification_id),
            VerificationEvent::Approved,
        );

        Ok(())
    }

    pub fn reject_verification(
        env: &Env,
        verification_id: u64,
        reason: String,
    ) -> Result<(), Error> {
        let mut record = read_record(env, verification_id)?;

        record.verifier.require_auth();
        record.status = String::from_str(env, "rejected");

        write_record(env, verification_id, &record);

        let reason_key = DataKey::RejectReason(verification_id);
        env.storage().persistent().set(&reason_key, &reason);
        bump_persistent(env, &reason_key);

        env.events().publish(
            (String::from_str(env, "rejection"), verification_id),
            VerificationEvent::Rejected,
        );

        Ok(())
    }

    pub fn get_verification(env: &Env, verification_id: u64) -> Result<VerificationRecord, Error> {
        read_record(env, verification_id)
    }

    pub fn get_verification_by_identity(env: &Env, identity_id: u64) -> Result<u64, Error> {
        let index_key = DataKey::IdentityIndex(identity_id);
        let verification_id: u64 = env
            .storage()
            .persistent()
            .get(&index_key)
            .ok_or(Error::VerificationNotFound)?;
        bump_persistent(env, &index_key);
        Ok(verification_id)
    }

    pub fn get_verification_status(env: &Env, verification_id: u64) -> Result<String, Error> {
        let record = read_record(env, verification_id)?;
        Ok(record.status)
    }

    pub fn revoke_verification(
        env: &Env,
        verification_id: u64,
        reason: String,
    ) -> Result<(), Error> {
        let mut record = read_record(env, verification_id)?;

        record.verifier.require_auth();

        record.revoked = true;
        record.revoked_at = env.ledger().timestamp();
        record.revocation_reason = reason;

        write_record(env, verification_id, &record);

        // Add to revocation list
        let mut revoked_list: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::RevokedList)
            .unwrap_or(Vec::new(env));

        revoked_list.push_back(verification_id);
        env.storage()
            .persistent()
            .set(&DataKey::RevokedList, &revoked_list);
        bump_persistent(env, &DataKey::RevokedList);

        // Emit revocation event
        env.events().publish(
            (String::from_str(env, "revocation"), verification_id),
            VerificationEvent::Revoked,
        );

        Ok(())
    }

    pub fn is_verification_revoked(env: &Env, verification_id: u64) -> Result<bool, Error> {
        let record = read_record(env, verification_id)?;
        Ok(record.revoked)
    }

    pub fn get_revocation_status(
        env: &Env,
        verification_id: u64,
    ) -> Result<(bool, u64, String), Error> {
        let record = read_record(env, verification_id)?;
        Ok((record.revoked, record.revoked_at, record.revocation_reason))
    }

    pub fn get_revoked_verifications(env: &Env) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::RevokedList)
            .unwrap_or(Vec::new(env))
    }

    pub fn is_verification_valid(env: &Env, verification_id: u64) -> Result<bool, Error> {
        let record = read_record(env, verification_id)?;
        Ok(record.status == String::from_str(env, "approved") && !record.revoked)
    }

    /// Validate a submitted zero-knowledge proof against the committed hashes.
    ///
    /// Recomputes the SHA-256 of the raw proof bytes and the public signals,
    /// then compares them to the `proof_hash` and `verification_commitment`
    /// stored when the proof was submitted. Returns `true` only when both the
    /// proof integrity and the commitment match and the record is not revoked.
    pub fn validate_proof(
        env: &Env,
        verification_id: u64,
        proof: Bytes,
        public_signals: Bytes,
    ) -> Result<bool, Error> {
        let record = read_record(env, verification_id)?;

        if record.revoked {
            env.events().publish(
                (String::from_str(env, "proof_validation"), verification_id),
                VerificationEvent::Validated(false),
            );
            return Ok(false);
        }

        let computed_proof_hash: BytesN<32> = env.crypto().sha256(&proof).into();
        let proof_integrity_ok = computed_proof_hash == record.proof_hash;

        let computed_commitment: BytesN<32> = env.crypto().sha256(&public_signals).into();
        let commitment_ok = computed_commitment == record.verification_commitment;

        let valid = proof_integrity_ok && commitment_ok;

        env.events().publish(
            (String::from_str(env, "proof_validation"), verification_id),
            VerificationEvent::Validated(valid),
        );

        Ok(valid)
    }
}

// ── Storage helpers ─────────────────────────────────────────────────────────

/// Read a credential record from persistent storage and extend its TTL so an
/// actively-used credential is not archived.
fn read_record(env: &Env, verification_id: u64) -> Result<VerificationRecord, Error> {
    let key = DataKey::Record(verification_id);
    let record: VerificationRecord = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::VerificationNotFound)?;
    bump_persistent(env, &key);
    Ok(record)
}

/// Persist a credential record and extend its TTL.
fn write_record(env: &Env, verification_id: u64, record: &VerificationRecord) {
    let key = DataKey::Record(verification_id);
    env.storage().persistent().set(&key, record);
    bump_persistent(env, &key);
}

fn bump_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
}
