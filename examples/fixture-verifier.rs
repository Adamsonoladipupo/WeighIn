#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

#[contract]
pub struct AuthVerifier;

#[contractimpl]
impl AuthVerifier {
    pub fn status(_env: Env) -> bool {
        true
    }

    pub fn verify(_env: Env, party: Address, _order: u64, _stage: Symbol) {
        party.require_auth();
    }
}
