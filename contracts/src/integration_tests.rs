extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Bytes, BytesN, Env, String,
};

use crate::{
    access_control::{AccessControl, AccessControlClient},
    data_sharing::{DataSharing, DataSharingClient},
    identity_registry::{IdentityRegistry, IdentityRegistryClient},
    verification::{Verification, VerificationClient},
};

fn setup() -> (
    Env,
    IdentityRegistryClient<'static>,
    VerificationClient<'static>,
    AccessControlClient<'static>,
    DataSharingClient<'static>,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let identity_id = env.register_contract(None, IdentityRegistry {});
    let identity = IdentityRegistryClient::new(&env, &identity_id);

    let verification_id = env.register_contract(None, Verification {});
    let verification = VerificationClient::new(&env, &verification_id);

    let access_id = env.register_contract(None, AccessControl {});
    let access = AccessControlClient::new(&env, &access_id);

    let sharing_id = env.register_contract(None, DataSharing {});
    let sharing = DataSharingClient::new(&env, &sharing_id);

    (env, identity, verification, access, sharing, admin)
}

// ── Identity Registry Integration ─────────────────────────────────────────────

#[test]
fn test_register_and_get_identity() {
    let (env, identity, _, _, _, _) = setup();
    let owner = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);
    let cid = String::from_str(&env, "QmTestCID123");

    let id = identity.register_identity(&owner, &doc_hash, &cid);
    let result = identity.get_identity(&id);

    assert_eq!(result.owner, owner);
    assert_eq!(result.document_hash, doc_hash);
    assert_eq!(result.ipfs_cid, cid);
    assert!(!result.verification_status);
    assert!(!result.revoked);
}

#[test]
fn test_update_identity_changes_hash_and_cid() {
    let (env, identity, _, _, _, _) = setup();
    let owner = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);
    let cid = String::from_str(&env, "QmOriginal");

    let id = identity.register_identity(&owner, &doc_hash, &cid);

    let new_hash = BytesN::from_array(&env, &[2u8; 32]);
    let new_cid = String::from_str(&env, "QmUpdated");
    identity.update_identity(&id, &new_hash, &new_cid);

    let result = identity.get_identity(&id);
    assert_eq!(result.document_hash, new_hash);
    assert_eq!(result.ipfs_cid, new_cid);
}

#[test]
fn test_revoke_identity_marks_as_revoked() {
    let (env, identity, _, _, _, _) = setup();
    let owner = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);
    let cid = String::from_str(&env, "QmRevocable");

    let id = identity.register_identity(&owner, &doc_hash, &cid);
    identity.revoke_identity(&id);

    let result = identity.get_identity(&id);
    assert!(result.revoked);
}

#[test]
fn test_register_multiple_identities_same_owner() {
    let (env, identity, _, _, _, _) = setup();
    let owner = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let id1 = identity.register_identity(&owner, &doc_hash, &String::from_str(&env, "QmFirst"));
    let id2 = identity.register_identity(&owner, &doc_hash, &String::from_str(&env, "QmSecond"));

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);

    let r1 = identity.get_identity(&id1);
    let r2 = identity.get_identity(&id2);
    assert_eq!(r1.owner, owner);
    assert_eq!(r2.owner, owner);
    assert_eq!(r1.document_hash, doc_hash);
    assert_eq!(r2.document_hash, doc_hash);
}

#[test]
fn test_mark_verified_and_is_verified() {
    let (env, identity, _, _, _, _) = setup();
    let owner = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let id = identity.register_identity(&owner, &doc_hash, &String::from_str(&env, "QmVerify"));

    assert!(!identity.is_verified(&id));
    identity.mark_verified(&id);
    assert!(identity.is_verified(&id));
}

#[test]
fn test_revoked_identity_not_verified() {
    let (env, identity, _, _, _, _) = setup();
    let owner = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let id = identity.register_identity(&owner, &doc_hash, &String::from_str(&env, "QmRevVer"));
    identity.mark_verified(&id);
    assert!(identity.is_verified(&id));

    identity.revoke_identity(&id);
    assert!(!identity.is_verified(&id));
}

// ── Verification Integration ──────────────────────────────────────────────────

#[test]
fn test_submit_and_approve_verification() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmVer"));

    let proof_hash = BytesN::from_array(&env, &[42u8; 32]);
    let commitment = BytesN::from_array(&env, &[99u8; 32]);
    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    let record = verification.get_verification(&v_id);
    assert_eq!(record.identity_id, identity_id);
    assert_eq!(record.verifier, verifier);
    assert_eq!(record.status, String::from_str(&env, "pending"));

    verification.approve_verification(&v_id);
    let approved = verification.get_verification(&v_id);
    assert_eq!(approved.status, String::from_str(&env, "approved"));
}

#[test]
fn test_submit_and_reject_verification() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmRej"));

    let proof_hash = BytesN::from_array(&env, &[42u8; 32]);
    let commitment = BytesN::from_array(&env, &[99u8; 32]);
    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    let reason = String::from_str(&env, "insufficient_proof");
    verification.reject_verification(&v_id, &reason);
    let rejected = verification.get_verification(&v_id);
    assert_eq!(rejected.status, String::from_str(&env, "rejected"));
}

#[test]
fn test_approve_verification_emits_event() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmEvt1"));
    let proof_hash = BytesN::from_array(&env, &[42u8; 32]);
    let commitment = BytesN::from_array(&env, &[99u8; 32]);
    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    let events_before = env.events().all().len();
    verification.approve_verification(&v_id);
    assert_eq!(env.events().all().len(), events_before + 1);
}

#[test]
fn test_reject_verification_emits_event() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmEvt2"));
    let proof_hash = BytesN::from_array(&env, &[42u8; 32]);
    let commitment = BytesN::from_array(&env, &[99u8; 32]);
    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    let events_before = env.events().all().len();
    verification.reject_verification(&v_id, &String::from_str(&env, "insufficient_proof"));
    assert_eq!(env.events().all().len(), events_before + 1);
}

#[test]
fn test_get_verification_status() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmStatus"));

    let proof_hash = BytesN::from_array(&env, &[1u8; 32]);
    let commitment = BytesN::from_array(&env, &[2u8; 32]);
    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    assert_eq!(
        verification.get_verification_status(&v_id),
        String::from_str(&env, "pending")
    );

    verification.approve_verification(&v_id);
    assert_eq!(
        verification.get_verification_status(&v_id),
        String::from_str(&env, "approved")
    );
}

#[test]
fn test_get_verification_by_identity() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmById"));

    let proof_hash = BytesN::from_array(&env, &[1u8; 32]);
    let commitment = BytesN::from_array(&env, &[2u8; 32]);
    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    let found_id = verification.get_verification_by_identity(&identity_id);
    assert_eq!(found_id, v_id);
}

// ── Zero-Knowledge Proof Validation Tests ────────────────────────────────────

#[test]
fn test_validate_proof_matching_hashes() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmZkValid"));

    // Submit a proof whose committed hashes match the raw bytes below.
    let raw_proof = Bytes::from_array(&env, &[7u8; 32]);
    let public_signals = Bytes::from_array(&env, &[8u8; 32]);

    let proof_hash: BytesN<32> = env.crypto().sha256(&raw_proof).into();
    let commitment: BytesN<32> = env.crypto().sha256(&public_signals).into();

    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    assert!(verification.validate_proof(&v_id, &raw_proof, &public_signals));
}

#[test]
fn test_validate_proof_tampered_proof_fails() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmZkTampered"));

    let raw_proof = Bytes::from_array(&env, &[7u8; 32]);
    let public_signals = Bytes::from_array(&env, &[8u8; 32]);

    let proof_hash: BytesN<32> = env.crypto().sha256(&raw_proof).into();
    let commitment: BytesN<32> = env.crypto().sha256(&public_signals).into();

    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    // Alter one byte of the proof — the integrity check must fail.
    let tampered = Bytes::from_array(&env, &[9u8; 32]);
    assert!(!verification.validate_proof(&v_id, &tampered, &public_signals));
}

#[test]
fn test_validate_proof_emits_event() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmZkEvent"));

    let raw_proof = Bytes::from_array(&env, &[7u8; 32]);
    let public_signals = Bytes::from_array(&env, &[8u8; 32]);

    let proof_hash: BytesN<32> = env.crypto().sha256(&raw_proof).into();
    let commitment: BytesN<32> = env.crypto().sha256(&public_signals).into();

    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    let events_before = env.events().all().len();
    let valid = verification.validate_proof(&v_id, &raw_proof, &public_signals);
    assert!(valid);
    assert_eq!(env.events().all().len(), events_before + 1);
}

// ── Credential Revocation Tests ──────────────────────────────────────────────

#[test]
fn test_revoke_verification_credential() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmRevoke"));

    let proof_hash = BytesN::from_array(&env, &[42u8; 32]);
    let commitment = BytesN::from_array(&env, &[99u8; 32]);
    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    verification.approve_verification(&v_id);

    assert!(!verification.is_verification_revoked(&v_id));

    let reason = String::from_str(&env, "credential_compromised");
    verification.revoke_verification(&v_id, &reason);

    assert!(verification.is_verification_revoked(&v_id));
}

#[test]
fn test_revocation_status_updates() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmStatus"));

    let proof_hash = BytesN::from_array(&env, &[42u8; 32]);
    let commitment = BytesN::from_array(&env, &[99u8; 32]);
    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    verification.approve_verification(&v_id);

    let (revoked, revoked_at, reason) = verification.get_revocation_status(&v_id);
    assert!(!revoked);
    assert_eq!(revoked_at, 0);
    assert_eq!(reason, String::from_str(&env, ""));

    let revoke_reason = String::from_str(&env, "security_breach");
    verification.revoke_verification(&v_id, &revoke_reason);

    let (revoked, revoked_at, reason) = verification.get_revocation_status(&v_id);
    assert!(revoked);
    let _ = revoked_at; // Timestamp is set but may be 0 in test environment
    assert_eq!(reason, revoke_reason);
}

#[test]
fn test_revocation_list_maintenance() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmList"));

    // Create multiple verifications
    let v_id1 = verification.submit_proof(
        &identity_id,
        &verifier,
        &BytesN::from_array(&env, &[1u8; 32]),
        &BytesN::from_array(&env, &[10u8; 32]),
    );
    let v_id2 = verification.submit_proof(
        &identity_id,
        &verifier,
        &BytesN::from_array(&env, &[2u8; 32]),
        &BytesN::from_array(&env, &[20u8; 32]),
    );

    let revoked_list = verification.get_revoked_verifications();
    assert_eq!(revoked_list.len(), 0);

    verification.revoke_verification(&v_id1, &String::from_str(&env, "reason1"));
    let revoked_list = verification.get_revoked_verifications();
    assert_eq!(revoked_list.len(), 1);
    assert_eq!(revoked_list.get(0).unwrap(), v_id1);

    verification.revoke_verification(&v_id2, &String::from_str(&env, "reason2"));
    let revoked_list = verification.get_revoked_verifications();
    assert_eq!(revoked_list.len(), 2);
    assert_eq!(revoked_list.get(0).unwrap(), v_id1);
    assert_eq!(revoked_list.get(1).unwrap(), v_id2);
}

#[test]
fn test_is_verification_valid() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmValid"));

    let proof_hash = BytesN::from_array(&env, &[42u8; 32]);
    let commitment = BytesN::from_array(&env, &[99u8; 32]);
    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    // Pending verification is not valid
    assert!(!verification.is_verification_valid(&v_id));

    verification.approve_verification(&v_id);

    // Approved verification is valid
    assert!(verification.is_verification_valid(&v_id));

    verification.revoke_verification(&v_id, &String::from_str(&env, "test_reason"));

    // Revoked verification is not valid
    assert!(!verification.is_verification_valid(&v_id));
}

#[test]
fn test_revoke_rejected_verification() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmRejRev"));

    let proof_hash = BytesN::from_array(&env, &[42u8; 32]);
    let commitment = BytesN::from_array(&env, &[99u8; 32]);
    let v_id = verification.submit_proof(&identity_id, &verifier, &proof_hash, &commitment);

    verification.reject_verification(&v_id, &String::from_str(&env, "invalid_proof"));

    // Can still revoke even if rejected
    verification.revoke_verification(&v_id, &String::from_str(&env, "fraudulent"));

    assert!(verification.is_verification_revoked(&v_id));
    assert!(!verification.is_verification_valid(&v_id));
}

#[test]
fn test_multiple_verifications_independent_revocation() {
    let (env, identity, verification, _, _, _) = setup();
    let user = Address::generate(&env);
    let verifier1 = Address::generate(&env);
    let verifier2 = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let identity_id =
        identity.register_identity(&user, &doc_hash, &String::from_str(&env, "QmMulti"));

    let v_id1 = verification.submit_proof(
        &identity_id,
        &verifier1,
        &BytesN::from_array(&env, &[1u8; 32]),
        &BytesN::from_array(&env, &[10u8; 32]),
    );
    let v_id2 = verification.submit_proof(
        &identity_id,
        &verifier2,
        &BytesN::from_array(&env, &[2u8; 32]),
        &BytesN::from_array(&env, &[20u8; 32]),
    );

    verification.approve_verification(&v_id1);
    verification.approve_verification(&v_id2);

    // Revoke first verification
    verification.revoke_verification(&v_id1, &String::from_str(&env, "reason1"));

    // First is revoked, second is still valid
    assert!(verification.is_verification_revoked(&v_id1));
    assert!(!verification.is_verification_revoked(&v_id2));
    assert!(!verification.is_verification_valid(&v_id1));
    assert!(verification.is_verification_valid(&v_id2));
}

// ── Access Control Integration ────────────────────────────────────────────────

#[test]
fn test_grant_and_check_access() {
    let (env, _, _, access, _, _) = setup();
    let grantor = Address::generate(&env);
    let grantee = Address::generate(&env);
    let resource_id: u64 = 1;

    let permission_id = access.grant_access(&grantor, &grantee, &resource_id, &3600);
    assert!(permission_id > 0);

    assert!(access.check_access(&grantee, &resource_id));
}

#[test]
fn test_check_access_denied_for_unknown() {
    let (env, _, _, access, _, _) = setup();
    let grantee = Address::generate(&env);

    assert!(!access.check_access(&grantee, &999));
}

#[test]
fn test_revoke_access() {
    let (env, _, _, access, _, _) = setup();
    let grantor = Address::generate(&env);
    let grantee = Address::generate(&env);

    let pid = access.grant_access(&grantor, &grantee, &1, &3600);
    assert!(access.check_access(&grantee, &1));

    access.revoke_access(&pid);
    assert!(!access.check_access(&grantee, &1));
}

#[test]
fn test_access_expires_after_duration() {
    let (env, _, _, access, _, _) = setup();
    let grantor = Address::generate(&env);
    let grantee = Address::generate(&env);
    let start_ts = env.ledger().timestamp();

    let _pid = access.grant_access(&grantor, &grantee, &1, &100);
    assert!(access.check_access(&grantee, &1));

    env.ledger().set_timestamp(start_ts + 200);
    assert!(!access.check_access(&grantee, &1));
}

#[test]
fn test_extend_access() {
    let (env, _, _, access, _, _) = setup();
    let grantor = Address::generate(&env);
    let grantee = Address::generate(&env);
    let start_ts = env.ledger().timestamp();

    let pid = access.grant_access(&grantor, &grantee, &1, &100);
    access.extend_access(&pid, &200);

    env.ledger().set_timestamp(start_ts + 150);
    assert!(access.check_access(&grantee, &1));

    env.ledger().set_timestamp(start_ts + 350);
    assert!(!access.check_access(&grantee, &1));
}

#[test]
fn test_get_permission() {
    let (env, _, _, access, _, _) = setup();
    let grantor = Address::generate(&env);
    let grantee = Address::generate(&env);

    let pid = access.grant_access(&grantor, &grantee, &42, &7200);
    let perm = access.get_permission(&pid);

    assert_eq!(perm.grantor, grantor);
    assert_eq!(perm.grantee, grantee);
    assert_eq!(perm.resource_id, 42);
    assert!(perm.is_active);
}

#[test]
fn test_grant_records_history_entry() {
    use crate::access_control::AccessAction;

    let (env, _, _, access, _, _) = setup();
    let grantor = Address::generate(&env);
    let grantee = Address::generate(&env);

    let pid = access.grant_access(&grantor, &grantee, &7, &3600);
    let history = access.get_access_history(&pid);

    assert_eq!(history.len(), 1);
    let entry = history.get(0).unwrap();
    assert_eq!(entry.permission_id, pid);
    assert_eq!(entry.grantee, grantee);
    assert_eq!(entry.resource_id, 7);
    assert_eq!(entry.actor, grantor);
    assert_eq!(entry.action, AccessAction::Granted);
}

#[test]
fn test_revoke_and_extend_append_to_history_in_order() {
    use crate::access_control::AccessAction;

    let (env, _, _, access, _, _) = setup();
    let grantor = Address::generate(&env);
    let grantee = Address::generate(&env);

    let pid = access.grant_access(&grantor, &grantee, &1, &1000);
    access.extend_access(&pid, &500);
    access.revoke_access(&pid);

    let history = access.get_access_history(&pid);
    assert_eq!(history.len(), 3);
    assert_eq!(history.get(0).unwrap().action, AccessAction::Granted);
    assert_eq!(history.get(1).unwrap().action, AccessAction::Extended);
    assert_eq!(history.get(2).unwrap().action, AccessAction::Revoked);
}

#[test]
fn test_access_history_empty_for_unknown_permission() {
    let (_, _, _, access, _, _) = setup();
    let history = access.get_access_history(&999);
    assert_eq!(history.len(), 0);
}

#[test]
fn test_access_history_is_per_permission() {
    let (env, _, _, access, _, _) = setup();
    let grantor = Address::generate(&env);
    let grantee_a = Address::generate(&env);
    let grantee_b = Address::generate(&env);

    let pid_a = access.grant_access(&grantor, &grantee_a, &1, &1000);
    let pid_b = access.grant_access(&grantor, &grantee_b, &2, &1000);
    access.revoke_access(&pid_a);

    assert_eq!(access.get_access_history(&pid_a).len(), 2);
    assert_eq!(access.get_access_history(&pid_b).len(), 1);
}

// ── Data Sharing Integration ─────────────────────────────────────────────────

#[test]
fn test_share_document_and_retrieve() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);
    let enc_key = Bytes::from_array(&env, &[10u8; 16]);

    let share_id = sharing.share_document(&owner, &recipient, &doc_hash, &enc_key, &86400);
    let result = sharing.get_shared_document(&share_id);

    assert_eq!(result.owner, owner);
    assert_eq!(result.recipient, recipient);
    assert_eq!(result.document_hash, doc_hash);
    assert!(result.is_active);
}

#[test]
fn test_is_share_active() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);

    let share_id = sharing.share_document(
        &owner,
        &recipient,
        &BytesN::from_array(&env, &[1u8; 32]),
        &Bytes::from_array(&env, &[10u8; 16]),
        &86400,
    );

    assert!(sharing.is_share_active(&share_id));
}

#[test]
fn test_revoke_shared_document() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);

    let share_id = sharing.share_document(
        &owner,
        &recipient,
        &BytesN::from_array(&env, &[1u8; 32]),
        &Bytes::from_array(&env, &[10u8; 16]),
        &86400,
    );

    assert!(sharing.is_share_active(&share_id));
    sharing.revoke_shared_document(&share_id);
    assert!(!sharing.is_share_active(&share_id));
}

#[test]
fn test_get_shared_document_by_parties() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);

    let share_id = sharing.share_document(
        &owner,
        &recipient,
        &doc_hash,
        &Bytes::from_array(&env, &[10u8; 16]),
        &3600,
    );

    let found = sharing.get_shared_document_by_parties(&owner, &recipient, &doc_hash);
    assert_eq!(found, share_id);
}

#[test]
fn test_share_expires_after_duration() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let start_ts = env.ledger().timestamp();

    let share_id = sharing.share_document(
        &owner,
        &recipient,
        &BytesN::from_array(&env, &[1u8; 32]),
        &Bytes::from_array(&env, &[10u8; 16]),
        &100,
    );

    assert!(sharing.is_share_active(&share_id));

    env.ledger().set_timestamp(start_ts + 200);
    assert!(!sharing.is_share_active(&share_id));
}

#[test]
fn test_extend_share() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let start_ts = env.ledger().timestamp();

    let share_id = sharing.share_document(
        &owner,
        &recipient,
        &BytesN::from_array(&env, &[1u8; 32]),
        &Bytes::from_array(&env, &[10u8; 16]),
        &100,
    );

    sharing.extend_share(&share_id, &200);

    env.ledger().set_timestamp(start_ts + 150);
    assert!(sharing.is_share_active(&share_id));

    env.ledger().set_timestamp(start_ts + 350);
    assert!(!sharing.is_share_active(&share_id));
}

// ── End-to-End Credential Flow ────────────────────────────────────────────────

#[test]
fn test_full_credential_lifecycle() {
    let (env, identity, verification, access, sharing, _) = setup();
    let patient = Address::generate(&env);
    let doctor = Address::generate(&env);
    let insurer = Address::generate(&env);
    let doc_hash = BytesN::from_array(&env, &[1u8; 32]);
    let proof_hash = BytesN::from_array(&env, &[42u8; 32]);
    let commitment = BytesN::from_array(&env, &[99u8; 32]);
    let enc_key = Bytes::from_array(&env, &[10u8; 16]);

    // 1. Patient registers identity
    let identity_id = identity.register_identity(
        &patient,
        &doc_hash,
        &String::from_str(&env, "QmPatientRecord"),
    );
    assert!(identity_id > 0);

    // 2. Doctor submits verification proof
    let v_id = verification.submit_proof(&identity_id, &doctor, &proof_hash, &commitment);

    // 3. Doctor approves verification
    verification.approve_verification(&v_id);
    assert_eq!(
        verification.get_verification_status(&v_id),
        String::from_str(&env, "approved")
    );

    // 4. Patient marks identity as verified on-chain
    identity.mark_verified(&identity_id);
    assert!(identity.is_verified(&identity_id));

    // 5. Patient grants insurer access to the verified credential
    let resource_id = identity_id;
    let permission_id = access.grant_access(&patient, &insurer, &resource_id, &2592000);
    assert!(access.check_access(&insurer, &resource_id));

    // 6. Patient shares encrypted document with insurer
    let share_id = sharing.share_document(&patient, &insurer, &doc_hash, &enc_key, &2592000);
    assert!(sharing.is_share_active(&share_id));

    // 7. Verify the full chain: insurer has access and can retrieve shared doc
    let shared = sharing.get_shared_document(&share_id);
    assert_eq!(shared.owner, patient);
    assert_eq!(shared.recipient, insurer);
    assert!(shared.is_active);

    // 8. Patient revokes access
    access.revoke_access(&permission_id);
    assert!(!access.check_access(&insurer, &resource_id));

    // 9. Patient revokes the shared document
    sharing.revoke_shared_document(&share_id);
    assert!(!sharing.is_share_active(&share_id));
}

// ── Error Scenarios ───────────────────────────────────────────────────────────

#[test]
#[should_panic]
fn test_get_nonexistent_identity_panics() {
    let (_, identity, _, _, _, _) = setup();
    identity.get_identity(&999);
}

#[test]
#[should_panic]
fn test_update_nonexistent_identity_panics() {
    let (env, identity, _, _, _, _) = setup();
    let hash = BytesN::from_array(&env, &[1u8; 32]);
    let cid = String::from_str(&env, "QmFail");
    identity.update_identity(&999, &hash, &cid);
}

#[test]
#[should_panic]
fn test_revoke_nonexistent_identity_panics() {
    let (_, identity, _, _, _, _) = setup();
    identity.revoke_identity(&999);
}

#[test]
#[should_panic]
fn test_mark_verified_nonexistent_identity_panics() {
    let (_, identity, _, _, _, _) = setup();
    identity.mark_verified(&999);
}

#[test]
#[should_panic]
fn test_get_nonexistent_verification_panics() {
    let (_, _, verification, _, _, _) = setup();
    verification.get_verification(&999);
}

#[test]
#[should_panic]
fn test_approve_nonexistent_verification_panics() {
    let (_, _, verification, _, _, _) = setup();
    verification.approve_verification(&999);
}

#[test]
#[should_panic]
fn test_reject_nonexistent_verification_panics() {
    let (env, _, verification, _, _, _) = setup();
    let reason = String::from_str(&env, "invalid");
    verification.reject_verification(&999, &reason);
}

#[test]
#[should_panic]
fn test_get_verification_by_nonexistent_identity_panics() {
    let (_, _, verification, _, _, _) = setup();
    verification.get_verification_by_identity(&999);
}

#[test]
#[should_panic]
fn test_get_verification_status_nonexistent_panics() {
    let (_, _, verification, _, _, _) = setup();
    verification.get_verification_status(&999);
}

#[test]
#[should_panic]
fn test_revoke_nonexistent_verification_panics() {
    let (env, _, verification, _, _, _) = setup();
    let reason = String::from_str(&env, "test");
    verification.revoke_verification(&999, &reason);
}

#[test]
#[should_panic]
fn test_is_verification_revoked_nonexistent_panics() {
    let (_, _, verification, _, _, _) = setup();
    verification.is_verification_revoked(&999);
}

#[test]
#[should_panic]
fn test_get_revocation_status_nonexistent_panics() {
    let (_, _, verification, _, _, _) = setup();
    verification.get_revocation_status(&999);
}

#[test]
#[should_panic]
fn test_is_verification_valid_nonexistent_panics() {
    let (_, _, verification, _, _, _) = setup();
    verification.is_verification_valid(&999);
}

#[test]
#[should_panic]
fn test_revoke_nonexistent_permission_panics() {
    let (_, _, _, access, _, _) = setup();
    access.revoke_access(&999);
}

#[test]
#[should_panic]
fn test_get_nonexistent_permission_panics() {
    let (_, _, _, access, _, _) = setup();
    access.get_permission(&999);
}

#[test]
#[should_panic]
fn test_extend_nonexistent_permission_panics() {
    let (_, _, _, access, _, _) = setup();
    access.extend_access(&999, &3600);
}

#[test]
#[should_panic]
fn test_get_nonexistent_shared_document_panics() {
    let (_, _, _, _, sharing, _) = setup();
    sharing.get_shared_document(&999);
}

#[test]
#[should_panic]
fn test_revoke_nonexistent_share_panics() {
    let (_, _, _, _, sharing, _) = setup();
    sharing.revoke_shared_document(&999);
}

#[test]
#[should_panic]
fn test_get_nonexistent_shared_document_by_parties_panics() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let hash = BytesN::from_array(&env, &[1u8; 32]);
    sharing.get_shared_document_by_parties(&owner, &recipient, &hash);
}

#[test]
#[should_panic]
fn test_is_share_active_nonexistent_panics() {
    let (_, _, _, _, sharing, _) = setup();
    sharing.is_share_active(&999);
}

#[test]
#[should_panic]
fn test_extend_nonexistent_share_panics() {
    let (_, _, _, _, sharing, _) = setup();
    sharing.extend_share(&999, &3600);
}

// ── Credential Sharing Integration ──────────────────────────────────────────

#[test]
fn test_share_credential_and_retrieve() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let cred_hash = BytesN::from_array(&env, &[5u8; 32]);
    let enc_key = Bytes::from_array(&env, &[20u8; 16]);

    let share_id = sharing.share_credential(
        &owner,
        &recipient,
        &cred_hash,
        &enc_key,
        &crate::types::SharingPermission::View,
        &86400,
    );

    let result = sharing.get_credential_share(&share_id);
    assert_eq!(result.owner, owner);
    assert_eq!(result.recipient, recipient);
    assert_eq!(result.permission, crate::types::SharingPermission::View);
    assert!(result.is_active);
}

#[test]
fn test_check_credential_access_active() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let cred_hash = BytesN::from_array(&env, &[6u8; 32]);

    sharing.share_credential(
        &owner,
        &recipient,
        &cred_hash,
        &Bytes::from_array(&env, &[30u8; 16]),
        &crate::types::SharingPermission::Download,
        &86400,
    );

    assert!(sharing.check_credential_access(&recipient, &cred_hash));
}

#[test]
fn test_check_credential_access_denied_for_unknown() {
    let (env, _, _, _, sharing, _) = setup();
    let unknown = Address::generate(&env);
    let cred_hash = BytesN::from_array(&env, &[7u8; 32]);
    assert!(!sharing.check_credential_access(&unknown, &cred_hash));
}

#[test]
fn test_revoke_credential_share() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let cred_hash = BytesN::from_array(&env, &[8u8; 32]);

    let share_id = sharing.share_credential(
        &owner,
        &recipient,
        &cred_hash,
        &Bytes::from_array(&env, &[40u8; 16]),
        &crate::types::SharingPermission::Download,
        &86400,
    );

    assert!(sharing.check_credential_access(&recipient, &cred_hash));

    let reason = soroban_sdk::String::from_str(&env, "compromised");
    sharing.revoke_credential_share(&share_id, &reason);

    assert!(!sharing.check_credential_access(&recipient, &cred_hash));
    let share = sharing.get_credential_share(&share_id);
    assert!(!share.is_active);
}

#[test]
fn test_extend_credential_share() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let cred_hash = BytesN::from_array(&env, &[9u8; 32]);
    let start_ts = env.ledger().timestamp();

    let share_id = sharing.share_credential(
        &owner,
        &recipient,
        &cred_hash,
        &Bytes::from_array(&env, &[50u8; 16]),
        &crate::types::SharingPermission::View,
        &100,
    );

    sharing.extend_credential_share(&share_id, &200);

    env.ledger().set_timestamp(start_ts + 150);
    assert!(sharing.check_credential_access(&recipient, &cred_hash));

    env.ledger().set_timestamp(start_ts + 350);
    assert!(!sharing.check_credential_access(&recipient, &cred_hash));
}

#[test]
fn test_share_credential_expires() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let cred_hash = BytesN::from_array(&env, &[10u8; 32]);
    let start_ts = env.ledger().timestamp();

    sharing.share_credential(
        &owner,
        &recipient,
        &cred_hash,
        &Bytes::from_array(&env, &[60u8; 16]),
        &crate::types::SharingPermission::View,
        &100,
    );

    assert!(sharing.check_credential_access(&recipient, &cred_hash));
    env.ledger().set_timestamp(start_ts + 200);
    assert!(!sharing.check_credential_access(&recipient, &cred_hash));
}

#[test]
fn test_re_share_credential() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let third_party = Address::generate(&env);
    let cred_hash = BytesN::from_array(&env, &[11u8; 32]);

    let share_id = sharing.share_credential(
        &owner,
        &recipient,
        &cred_hash,
        &Bytes::from_array(&env, &[70u8; 16]),
        &crate::types::SharingPermission::ReShare,
        &86400,
    );

    let new_share_id = sharing.re_share_credential(
        &share_id,
        &third_party,
        &crate::types::SharingPermission::View,
        &3600,
    );

    assert!(sharing.check_credential_access(&third_party, &cred_hash));
    let new_share = sharing.get_credential_share(&new_share_id);
    assert_eq!(new_share.permission, crate::types::SharingPermission::View);
}

#[test]
fn test_re_share_denied_without_permission() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let third_party = Address::generate(&env);
    let cred_hash = BytesN::from_array(&env, &[12u8; 32]);

    let share_id = sharing.share_credential(
        &owner,
        &recipient,
        &cred_hash,
        &Bytes::from_array(&env, &[80u8; 16]),
        &crate::types::SharingPermission::View,
        &86400,
    );

    let res = sharing.try_re_share_credential(
        &share_id,
        &third_party,
        &crate::types::SharingPermission::View,
        &3600,
    );
    assert!(res.is_err());
}

#[test]
fn test_revoke_expired_share() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let cred_hash = BytesN::from_array(&env, &[13u8; 32]);
    let start_ts = env.ledger().timestamp();

    let share_id = sharing.share_credential(
        &owner,
        &recipient,
        &cred_hash,
        &Bytes::from_array(&env, &[90u8; 16]),
        &crate::types::SharingPermission::Download,
        &100,
    );

    env.ledger().set_timestamp(start_ts + 200);
    let reason = soroban_sdk::String::from_str(&env, "expired");
    sharing.revoke_credential_share(&share_id, &reason);

    let share = sharing.get_credential_share(&share_id);
    assert!(!share.is_active);
    assert_eq!(share.revocation_reason, reason);
}

#[test]
fn test_get_shares_by_owner_and_recipient() {
    let (env, _, _, _, sharing, _) = setup();
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);
    let cred_hash = BytesN::from_array(&env, &[14u8; 32]);

    sharing.share_credential(
        &owner,
        &recipient,
        &cred_hash,
        &Bytes::from_array(&env, &[100u8; 16]),
        &crate::types::SharingPermission::View,
        &86400,
    );

    let owner_shares = sharing.get_shares_by_owner(&owner);
    assert_eq!(owner_shares.len(), 1);

    let recipient_shares = sharing.get_shares_by_recipient(&recipient);
    assert_eq!(recipient_shares.len(), 1);
}

#[test]
#[should_panic]
fn test_get_nonexistent_credential_share_panics() {
    let (_, _, _, _, sharing, _) = setup();
    sharing.get_credential_share(&999);
}

#[test]
#[should_panic]
fn test_revoke_nonexistent_credential_share_panics() {
    let (env, _, _, _, sharing, _) = setup();
    let reason = soroban_sdk::String::from_str(&env, "test");
    sharing.revoke_credential_share(&999, &reason);
}
