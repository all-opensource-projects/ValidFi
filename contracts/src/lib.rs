#![no_std]

pub mod access_control;
pub mod auditing;
pub mod data_sharing;
pub mod errors;
pub mod events;
pub mod identity_registry;
pub mod storage;
pub mod types;
pub mod upgrade;
pub mod vaccination_verification;
pub mod verification;

#[cfg(test)]
mod upgrade_tests;

#[cfg(test)]
mod integration_tests;

#[cfg(test)]
mod benchmarks;

#[cfg(test)]
mod test;

#[cfg(test)]
mod vaccination_verification_tests;

pub use access_control::AccessControl;
pub use data_sharing::DataSharing;
pub use errors::Error;
pub use identity_registry::IdentityRegistry;
pub use vaccination_verification::VaccinationVerification;
pub use verification::Verification;
