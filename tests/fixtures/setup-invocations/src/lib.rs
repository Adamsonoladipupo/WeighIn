#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

#[contract]
pub struct InitializedContract;

/// Bundled contract fixture that has no constructor: persistent key `value`
/// does not exist until committed setup invocations populate it in order.
/// Subsequent benchmark invocations read that committed state and fail if
/// initialization did not commit.
#[contractimpl]
impl InitializedContract {
    /// Setup step 1: seed persistent `value`. Fails if already initialized.
    pub fn initialize(env: Env, value: u32) -> u32 {
        let key = symbol_short!("value");
        assert!(
            !env.storage().persistent().has(&key),
            "already initialized"
        );
        env.storage().persistent().set(&key, &value);
        value
    }

    /// Setup step 2: add `delta` to the initialized `value`. Requires step 1
    /// to have committed first.
    pub fn add(env: Env, delta: u32) -> u32 {
        let key = symbol_short!("value");
        let current: u32 = env
            .storage()
            .persistent()
            .get(&key)
            .expect("not initialized");
        let next = current + delta;
        env.storage().persistent().set(&key, &next);
        next
    }

    /// Benchmark read: returns the committed persistent `value`. Panics if
    /// setup invocations were not committed.
    pub fn read_value(env: Env) -> u32 {
        let key = symbol_short!("value");
        env.storage()
            .persistent()
            .get(&key)
            .expect("not initialized")
    }

    /// Benchmark read-and-verify: asserts committed persistent `value` equals
    /// `expected` and returns `ok`.
    pub fn check_value(env: Env, expected: u32) -> Symbol {
        let actual = Self::read_value(env);
        assert_eq!(actual, expected, "unexpected committed value");
        symbol_short!("ok")
    }
}
