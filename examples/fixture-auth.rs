#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, IntoVal};

#[contract]
pub struct AuthFixture;

#[contractimpl]
impl AuthFixture {
    pub fn approve(env: Env, verifier: Address, buyer: Address, seller: Address, order: u64) {
        buyer.require_auth();
        seller.require_auth();
        for party in [buyer, seller] {
            for stage in [symbol_short!("review"), symbol_short!("confirm")] {
                env.invoke_contract::<()>(
                    &verifier,
                    &symbol_short!("verify"),
                    (&party, order, stage).into_val(&env),
                );
            }
        }
    }
}
