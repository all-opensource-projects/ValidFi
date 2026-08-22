#![cfg(test)]

use crate::vaccination_verification::{
    VaccinationStatus, VaccinationVerification, VaccinationVerificationClient,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Bytes, BytesN, Env, String,
};

fn setup_env<'a>() -> (Env, VaccinationVerificationClient<'a>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, VaccinationVerification);
    let client = VaccinationVerificationClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    (env, client, issuer)
}

fn compute_proof_hash(env: &Env, zk_proof: &BytesN<32>) -> BytesN<32> {
    let proof_bytes: Bytes = zk_proof.into();
    let hash = env.crypto().sha256(&proof_bytes);
    hash.into()
}

fn submit_test_credential(
    env: &Env,
    client: &VaccinationVerificationClient,
    issuer: &Address,
) -> u64 {
    let vaccine_type = String::from_str(env, "COVID-19");
    let lot_number = String::from_str(env, "LOT-2024-A1");
    let zk_proof = BytesN::from_array(env, &[2; 32]);
    let proof_hash = compute_proof_hash(env, &zk_proof);

    client.submit_credential(
        issuer,
        &1u64,
        &vaccine_type,
        &1u32,
        &2u32,
        &lot_number,
        &1000u64,
        &9999999u64,
        &proof_hash,
        &zk_proof,
    )
}

#[test]
fn test_submit_credential() {
    let (env, client, issuer) = setup_env();
    let credential_id = submit_test_credential(&env, &client, &issuer);
    assert_eq!(credential_id, 1);

    let credential = client.get_credential(&credential_id);
    assert_eq!(credential.patient_id, 1);
    assert_eq!(credential.status, VaccinationStatus::Pending);
    assert!(!credential.verified);
}

#[test]
fn test_submit_multiple_credentials() {
    let (env, client, issuer) = setup_env();

    let id1 = submit_test_credential(&env, &client, &issuer);

    let vaccine_type = String::from_str(&env, "COVID-19");
    let lot_number = String::from_str(&env, "LOT-2024-B2");
    let proof_hash = BytesN::from_array(&env, &[3; 32]);
    let zk_proof = BytesN::from_array(&env, &[4; 32]);

    let id2 = client.submit_credential(
        &issuer,
        &2u64,
        &vaccine_type,
        &2u32,
        &2u32,
        &lot_number,
        &2000u64,
        &9999999u64,
        &proof_hash,
        &zk_proof,
    );

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

#[test]
fn test_verify_credential_valid_proof() {
    let (env, client, issuer) = setup_env();
    let credential_id = submit_test_credential(&env, &client, &issuer);

    let verifier = Address::generate(&env);
    let result = client.verify_credential(&credential_id, &verifier);
    assert!(result);

    let status = client.check_vaccination_status(&credential_id);
    assert_eq!(status, VaccinationStatus::Valid);

    let credential = client.get_credential(&credential_id);
    assert!(credential.verified);
    assert_eq!(credential.verified_at, env.ledger().timestamp());
}

#[test]
fn test_verify_credential_invalid_proof() {
    let (env, client, issuer) = setup_env();

    let vaccine_type = String::from_str(&env, "COVID-19");
    let lot_number = String::from_str(&env, "LOT-2024-C3");
    let proof_hash = BytesN::from_array(&env, &[10; 32]);
    let zk_proof = BytesN::from_array(&env, &[20; 32]);

    let credential_id = client.submit_credential(
        &issuer,
        &1u64,
        &vaccine_type,
        &1u32,
        &2u32,
        &lot_number,
        &1000u64,
        &9999999u64,
        &proof_hash,
        &zk_proof,
    );

    let verifier = Address::generate(&env);
    let result = client.verify_credential(&credential_id, &verifier);
    assert!(!result);

    let status = client.check_vaccination_status(&credential_id);
    assert_eq!(status, VaccinationStatus::Invalid);
}

#[test]
fn test_verify_expired_credential() {
    let (env, client, issuer) = setup_env();

    let vaccine_type = String::from_str(&env, "COVID-19");
    let lot_number = String::from_str(&env, "LOT-2024-D4");
    let zk_proof = BytesN::from_array(&env, &[2; 32]);
    let proof_hash = compute_proof_hash(&env, &zk_proof);

    let credential_id = client.submit_credential(
        &issuer,
        &1u64,
        &vaccine_type,
        &1u32,
        &2u32,
        &lot_number,
        &1000u64,
        &500u64,
        &proof_hash,
        &zk_proof,
    );

    env.ledger().set_timestamp(1000);

    let verifier = Address::generate(&env);
    let result = client.verify_credential(&credential_id, &verifier);
    assert!(!result);

    let status = client.check_vaccination_status(&credential_id);
    assert_eq!(status, VaccinationStatus::Expired);
}

#[test]
fn test_check_vaccination_status() {
    let (env, client, issuer) = setup_env();
    let credential_id = submit_test_credential(&env, &client, &issuer);

    let status = client.check_vaccination_status(&credential_id);
    assert_eq!(status, VaccinationStatus::Pending);

    let verifier = Address::generate(&env);
    client.verify_credential(&credential_id, &verifier);

    let status = client.check_vaccination_status(&credential_id);
    assert_eq!(status, VaccinationStatus::Valid);
}

#[test]
fn test_is_fully_vaccinated() {
    let (env, client, issuer) = setup_env();

    let vaccine_type = String::from_str(&env, "COVID-19");
    let lot_number = String::from_str(&env, "LOT-2024-E5");
    let zk_proof = BytesN::from_array(&env, &[2; 32]);
    let proof_hash = compute_proof_hash(&env, &zk_proof);

    let credential_id = client.submit_credential(
        &issuer,
        &1u64,
        &vaccine_type,
        &2u32,
        &2u32,
        &lot_number,
        &1000u64,
        &9999999u64,
        &proof_hash,
        &zk_proof,
    );

    assert!(!client.is_fully_vaccinated(&1u64));

    let verifier = Address::generate(&env);
    client.verify_credential(&credential_id, &verifier);

    assert!(client.is_fully_vaccinated(&1u64));
}

#[test]
fn test_revoke_credential() {
    let (env, client, issuer) = setup_env();
    let credential_id = submit_test_credential(&env, &client, &issuer);

    let verifier = Address::generate(&env);
    client.verify_credential(&credential_id, &verifier);

    let reason = String::from_str(&env, "Adverse reaction reported");
    client.revoke_credential(&credential_id, &issuer, &reason);

    let status = client.check_vaccination_status(&credential_id);
    assert_eq!(status, VaccinationStatus::Revoked);
}

#[test]
fn test_revoke_unauthorized() {
    let (env, client, issuer) = setup_env();
    let credential_id = submit_test_credential(&env, &client, &issuer);

    let other = Address::generate(&env);
    let reason = String::from_str(&env, "Unauthorized attempt");
    let result = client.try_revoke_credential(&credential_id, &other, &reason);
    assert!(result.is_err());
}

#[test]
fn test_verify_revoked_credential_fails() {
    let (env, client, issuer) = setup_env();
    let credential_id = submit_test_credential(&env, &client, &issuer);

    let reason = String::from_str(&env, "Revoked before verification");
    client.revoke_credential(&credential_id, &issuer, &reason);

    let verifier = Address::generate(&env);
    let result = client.try_verify_credential(&credential_id, &verifier);
    assert!(result.is_err());
}

#[test]
fn test_invalid_dose_number() {
    let (env, client, issuer) = setup_env();

    let vaccine_type = String::from_str(&env, "COVID-19");
    let lot_number = String::from_str(&env, "LOT-2024-F6");
    let proof_hash = BytesN::from_array(&env, &[1; 32]);
    let zk_proof = BytesN::from_array(&env, &[2; 32]);

    let result = client.try_submit_credential(
        &issuer,
        &1u64,
        &vaccine_type,
        &3u32,
        &2u32,
        &lot_number,
        &1000u64,
        &9999999u64,
        &proof_hash,
        &zk_proof,
    );

    assert!(result.is_err());
}

#[test]
fn test_get_credential_not_found() {
    let (_, client, _) = setup_env();
    let result = client.try_get_credential(&999u64);
    assert!(result.is_err());
}

#[test]
fn test_authorize_verifier() {
    let (env, client, issuer) = setup_env();
    let verifier = Address::generate(&env);

    client.authorize_verifier(&issuer, &verifier);

    let credential_id = submit_test_credential(&env, &client, &issuer);
    let result = client.verify_credential(&credential_id, &verifier);
    assert!(result);
}

#[test]
fn test_unauthorized_verifier_rejected() {
    let (env, client, issuer) = setup_env();
    let authorized = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    client.authorize_verifier(&issuer, &authorized);

    let credential_id = submit_test_credential(&env, &client, &issuer);
    let result = client.try_verify_credential(&credential_id, &unauthorized);
    assert!(result.is_err());
}

#[test]
fn test_get_credential_by_patient() {
    let (env, client, issuer) = setup_env();
    submit_test_credential(&env, &client, &issuer);

    let credential_id = client.get_credential_by_patient(&1u64);
    assert_eq!(credential_id, 1);
}

#[test]
fn test_events_emitted_on_submit() {
    let (env, client, issuer) = setup_env();
    let _credential_id = submit_test_credential(&env, &client, &issuer);

    let events = env.events().all();
    assert!(!events.is_empty());
}

#[test]
fn test_events_emitted_on_verify() {
    let (env, client, issuer) = setup_env();
    let credential_id = submit_test_credential(&env, &client, &issuer);

    let verifier = Address::generate(&env);
    client.verify_credential(&credential_id, &verifier);

    let events = env.events().all();
    assert!(events.len() >= 2);
}

#[test]
fn test_events_emitted_on_revoke() {
    let (env, client, issuer) = setup_env();
    let credential_id = submit_test_credential(&env, &client, &issuer);

    let reason = String::from_str(&env, "Test revocation");
    client.revoke_credential(&credential_id, &issuer, &reason);

    let events = env.events().all();
    assert!(events.len() >= 2);
}
