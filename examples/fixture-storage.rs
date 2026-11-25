#![no_std]

use soroban_sdk::{contract, contractimpl, Bytes, Env, Vec};

#[contract]
pub struct StorageFixture;

#[contractimpl]
impl StorageFixture {
    pub fn __constructor(env: Env) {
        let value = Bytes::from_array(&env, &[0; 2048]);
        for key in 0..16_u32 {
            env.storage().persistent().set(&key, &value);
        }
    }

    pub fn read_entries(env: Env, keys: Vec<u32>) -> u32 {
        keys.iter()
            .map(|key| {
                env.storage()
                    .persistent()
                    .get::<_, Bytes>(&key)
                    .unwrap()
                    .len()
            })
            .sum()
    }
}
