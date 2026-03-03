use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp_global,
};
use starknet::ContractAddress;
use bitbridge_contracts::IBitBridgePayDispatcher;
use bitbridge_contracts::IBitBridgePayDispatcherTrait;

// ---------------------------------------------------------------------------
// Mock: Settlement Token (minimal ERC20 with transfer + balance tracking)
// ---------------------------------------------------------------------------
#[starknet::interface]
trait IMockToken<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256);
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
}

#[starknet::contract]
mod MockToken {
    use starknet::storage::{Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
    }

    #[abi(embed_v0)]
    impl MockTokenImpl of super::IMockToken<ContractState> {
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            let sender = get_caller_address();
            let sender_balance = self.balances.entry(sender).read();
            assert(sender_balance >= amount, 'insufficient_balance');
            self.balances.entry(sender).write(sender_balance - amount);
            let recipient_balance = self.balances.entry(recipient).read();
            self.balances.entry(recipient).write(recipient_balance + amount);
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }

        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            let current = self.balances.entry(to).read();
            self.balances.entry(to).write(current + amount);
        }
    }
}

// ---------------------------------------------------------------------------
// Mock: Pragma Oracle
// ---------------------------------------------------------------------------
#[starknet::interface]
trait IMockOracle<TContractState> {
    fn get_data_median(
        self: @TContractState, data_type: MockOracle::PragmaDataType,
    ) -> MockOracle::PragmaPricesResponse;
    fn set_price(
        ref self: TContractState,
        pair_id: felt252,
        price: u128,
        decimals: u32,
        last_updated_timestamp: u64,
        num_sources_aggregated: u32,
    );
}

#[starknet::contract]
mod MockOracle {
    use starknet::storage::{Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess};

    #[derive(Drop, Copy, Serde)]
    pub enum PragmaDataType {
        SpotEntry: felt252,
    }

    #[derive(Drop, Copy, Serde)]
    pub struct PragmaPricesResponse {
        pub price: u128,
        pub decimals: u32,
        pub last_updated_timestamp: u64,
        pub num_sources_aggregated: u32,
    }

    #[storage]
    struct Storage {
        prices: Map<felt252, u128>,
        decimals_map: Map<felt252, u32>,
        timestamps: Map<felt252, u64>,
        sources: Map<felt252, u32>,
    }

    #[abi(embed_v0)]
    impl MockOracleImpl of super::IMockOracle<ContractState> {
        fn get_data_median(
            self: @ContractState, data_type: PragmaDataType,
        ) -> PragmaPricesResponse {
            let pair_id = match data_type {
                PragmaDataType::SpotEntry(id) => id,
            };
            PragmaPricesResponse {
                price: self.prices.entry(pair_id).read(),
                decimals: self.decimals_map.entry(pair_id).read(),
                last_updated_timestamp: self.timestamps.entry(pair_id).read(),
                num_sources_aggregated: self.sources.entry(pair_id).read(),
            }
        }

        fn set_price(
            ref self: ContractState,
            pair_id: felt252,
            price: u128,
            decimals: u32,
            last_updated_timestamp: u64,
            num_sources_aggregated: u32,
        ) {
            self.prices.entry(pair_id).write(price);
            self.decimals_map.entry(pair_id).write(decimals);
            self.timestamps.entry(pair_id).write(last_updated_timestamp);
            self.sources.entry(pair_id).write(num_sources_aggregated);
        }
    }
}

// ---------------------------------------------------------------------------
// Test addresses
// ---------------------------------------------------------------------------
fn OWNER() -> ContractAddress {
    'owner'.try_into().unwrap()
}

fn ATTESTOR() -> ContractAddress {
    'attestor'.try_into().unwrap()
}

fn MERCHANT() -> ContractAddress {
    'merchant'.try_into().unwrap()
}

fn ALICE() -> ContractAddress {
    'alice'.try_into().unwrap()
}

fn ZERO() -> ContractAddress {
    (0_felt252).try_into().unwrap()
}

const BTC_USD: felt252 = 'BTC/USD';
const STRK_USD: felt252 = 'STRK/USD';
const PAYMENT_ID: felt252 = 'pay_001';
const BTC_ADDR: felt252 = 'bc1q_test_btc_address';
const NOW: u64 = 1000000;

// ---------------------------------------------------------------------------
// Deployment helpers
// ---------------------------------------------------------------------------
fn deploy_mock_token() -> (ContractAddress, IMockTokenDispatcher) {
    let contract = declare("MockToken").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    (addr, IMockTokenDispatcher { contract_address: addr })
}

fn deploy_mock_oracle() -> (ContractAddress, IMockOracleDispatcher) {
    let contract = declare("MockOracle").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    (addr, IMockOracleDispatcher { contract_address: addr })
}

/// Deploy BitBridgePay with USD-pegged settlement (pair_id = 0, decimals = 6, like USDC).
fn deploy_bitbridge_usdc() -> (
    IBitBridgePayDispatcher, IMockTokenDispatcher, IMockOracleDispatcher,
) {
    let (token_addr, token) = deploy_mock_token();
    let (oracle_addr, oracle) = deploy_mock_oracle();

    let contract = declare("BitBridgePay").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    // attestor
    calldata.append(ATTESTOR().into());
    // oracle_address
    calldata.append(oracle_addr.into());
    // owner
    calldata.append(OWNER().into());
    // settlement_token
    calldata.append(token_addr.into());
    // settlement_pair_id (0 for USD-pegged)
    calldata.append(0);
    // settlement_token_decimals (6 for USDC)
    calldata.append(6);

    let (addr, _) = contract.deploy(@calldata).unwrap();
    let dispatcher = IBitBridgePayDispatcher { contract_address: addr };

    // Fund the contract with tokens
    token.mint(addr, 1000000_000000_u256); // 1M USDC

    // Set oracle BTC/USD = $100,000.00 with 8 decimals => 10_000_000_000_000
    oracle
        .set_price(BTC_USD, 10_000_000_000_000_u128, 8, NOW, 5);

    start_cheat_block_timestamp_global(NOW);

    (dispatcher, token, oracle)
}

/// Deploy BitBridgePay with STRK settlement (pair_id = 'STRK/USD', decimals = 18).
fn deploy_bitbridge_strk() -> (
    IBitBridgePayDispatcher, IMockTokenDispatcher, IMockOracleDispatcher,
) {
    let (token_addr, token) = deploy_mock_token();
    let (oracle_addr, oracle) = deploy_mock_oracle();

    let contract = declare("BitBridgePay").unwrap().contract_class();
    let mut calldata: Array<felt252> = array![];
    calldata.append(ATTESTOR().into());
    calldata.append(oracle_addr.into());
    calldata.append(OWNER().into());
    calldata.append(token_addr.into());
    calldata.append(STRK_USD); // non-zero pair id
    calldata.append(18);

    let (addr, _) = contract.deploy(@calldata).unwrap();
    let dispatcher = IBitBridgePayDispatcher { contract_address: addr };

    // Fund the contract with a large STRK balance
    token.mint(addr, 1000000_000000000000000000_u256); // 1M STRK

    // BTC/USD = $100,000 (8 decimals)
    oracle.set_price(BTC_USD, 10_000_000_000_000_u128, 8, NOW, 5);
    // STRK/USD = $0.50 (8 decimals) => 50_000_000
    oracle.set_price(STRK_USD, 50_000_000_u128, 8, NOW, 5);

    start_cheat_block_timestamp_global(NOW);

    (dispatcher, token, oracle)
}

// ---------------------------------------------------------------------------
// Helper: create a standard test payment
// ---------------------------------------------------------------------------
fn create_test_payment(dispatcher: IBitBridgePayDispatcher) {
    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.create_payment(MERCHANT(), 100_000000_u128, PAYMENT_ID, BTC_ADDR, 100_000_u64, false);
    stop_cheat_caller_address(dispatcher.contract_address);
}

// ===========================================================================
// CONSTRUCTOR & GETTERS
// ===========================================================================
#[test]
fn test_constructor_sets_state() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    assert(dispatcher.get_attestor() == ATTESTOR(), 'wrong attestor');
    assert(dispatcher.get_settlement_pair_id() == 0, 'wrong pair_id');
    assert(dispatcher.get_settlement_token_decimals() == 6, 'wrong decimals');
    assert(dispatcher.get_pending_owner() == ZERO(), 'pending should be zero');
}

// ===========================================================================
// CREATE PAYMENT
// ===========================================================================
#[test]
fn test_create_payment_success() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    let p = dispatcher.get_payment(PAYMENT_ID);
    assert(p.initialized, 'not initialized');
    assert(p.merchant == MERCHANT(), 'wrong merchant');
    assert(p.amount_settlement_units == 100_000000_u128, 'wrong amount');
    assert(p.btc_address == BTC_ADDR, 'wrong btc addr');
    assert(p.required_btc_sats == 100_000_u64, 'wrong req sats');
    assert(!p.settled, 'should not be settled');
    assert(!p.cancelled, 'should not be cancelled');
    assert(p.expires_at == NOW + 86400, 'wrong expiry');
}

#[test]
#[should_panic(expected: ('caller_must_be_merchant',))]
fn test_create_payment_wrong_caller() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    start_cheat_caller_address(dispatcher.contract_address, ALICE());
    dispatcher.create_payment(MERCHANT(), 100_000000_u128, PAYMENT_ID, BTC_ADDR, 100_000_u64, false);
}

#[test]
#[should_panic(expected: ('payment_id_exists',))]
fn test_create_payment_duplicate_id() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);
    // Second create with same ID should fail
    create_test_payment(dispatcher);
}

#[test]
#[should_panic(expected: ('amt_pos',))]
fn test_create_payment_zero_amount() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.create_payment(MERCHANT(), 0_u128, PAYMENT_ID, BTC_ADDR, 100_000_u64, false);
}

#[test]
#[should_panic(expected: ('req_btc_pos',))]
fn test_create_payment_zero_btc_sats() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.create_payment(MERCHANT(), 100_000000_u128, PAYMENT_ID, BTC_ADDR, 0_u64, false);
}

// ===========================================================================
// SUBMIT ATTESTATION — USD-pegged (USDC)
// ===========================================================================
#[test]
fn test_submit_attestation_usdc() {
    let (dispatcher, token, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    let merchant_bal_before = token.balance_of(MERCHANT());

    // Attestor submits: 100_000 sats at BTC=$100k => $100 => 100_000000 USDC
    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 0xdeadbeef, high: 0 }, 100_000_u64, 800_000_u64);
    stop_cheat_caller_address(dispatcher.contract_address);

    let p = dispatcher.get_payment(PAYMENT_ID);
    assert(p.settled, 'should be settled');
    assert(p.btc_block_height == 800_000_u64, 'wrong block height');
    assert(p.btc_txid == u256 { low: 0xdeadbeef, high: 0 }, 'wrong txid');

    // Merchant should have received tokens
    let merchant_bal_after = token.balance_of(MERCHANT());
    assert(merchant_bal_after > merchant_bal_before, 'no tokens received');
}

#[test]
#[should_panic(expected: ('attestor_only',))]
fn test_submit_attestation_wrong_caller() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    start_cheat_caller_address(dispatcher.contract_address, ALICE());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
}

#[test]
#[should_panic(expected: ('payment_not_initialized',))]
fn test_submit_attestation_nonexistent_payment() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation('no_such_pay', u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
}

#[test]
#[should_panic(expected: ('already_settled',))]
fn test_submit_attestation_double_settle() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
    // Second attempt
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 2, high: 0 }, 100_000_u64, 800_001_u64);
}

#[test]
#[should_panic(expected: ('payment_cancelled',))]
fn test_submit_attestation_cancelled_payment() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    // Merchant cancels
    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.cancel_payment(PAYMENT_ID);
    stop_cheat_caller_address(dispatcher.contract_address);

    // Attestor tries to settle
    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
}

#[test]
#[should_panic(expected: ('btc_below_required',))]
fn test_submit_attestation_insufficient_btc() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher); // requires 100_000 sats

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 99_999_u64, 800_000_u64);
}

#[test]
#[should_panic(expected: ('payment_expired',))]
fn test_submit_attestation_expired() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    // Fast-forward past expiry
    start_cheat_block_timestamp_global(NOW + 86401);

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
}

// ===========================================================================
// SUBMIT ATTESTATION — Token with oracle (STRK)
// ===========================================================================
#[test]
fn test_submit_attestation_strk() {
    let (dispatcher, token, _) = deploy_bitbridge_strk();

    // Create payment: merchant wants some STRK for 100_000 sats
    // At BTC=$100k, 100k sats = $100. At STRK=$0.50, that's 200 STRK = 200 * 10^18
    let expected_strk: u128 = 200;
    let amount_settlement: u128 = expected_strk * 1_000000000000000000; // 200 STRK in base units

    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.create_payment(MERCHANT(), amount_settlement, PAYMENT_ID, BTC_ADDR, 100_000_u64, false);
    stop_cheat_caller_address(dispatcher.contract_address);

    let merchant_bal_before = token.balance_of(MERCHANT());

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 0xcafe, high: 0 }, 100_000_u64, 800_000_u64);
    stop_cheat_caller_address(dispatcher.contract_address);

    let p = dispatcher.get_payment(PAYMENT_ID);
    assert(p.settled, 'should be settled');

    let merchant_bal_after = token.balance_of(MERCHANT());
    let received = merchant_bal_after - merchant_bal_before;
    // Expected: 200 STRK (200 * 10^18)
    let expected: u256 = 200_000000000000000000_u256;
    assert(received == expected, 'wrong strk amount');
}

// ===========================================================================
// SLIPPAGE
// ===========================================================================
#[test]
#[should_panic(expected: ('price_slippage_exceeded',))]
fn test_submit_attestation_slippage_exceeded() {
    let (dispatcher, _, oracle) = deploy_bitbridge_usdc();

    // Merchant expects $100 USDC for 100k sats
    create_test_payment(dispatcher);

    // Drop BTC price so oracle returns much less than expected
    // Need oracle amount < 95% of 100_000000 = 95_000000
    // At $94k BTC: 100k sats = $94 = 94_000000 USDC → below 95_000000 floor
    oracle.set_price(BTC_USD, 9_400_000_000_000_u128, 8, NOW, 5);

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
}

// ===========================================================================
// CANCEL PAYMENT
// ===========================================================================
#[test]
fn test_cancel_payment_by_merchant() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.cancel_payment(PAYMENT_ID);
    stop_cheat_caller_address(dispatcher.contract_address);

    let p = dispatcher.get_payment(PAYMENT_ID);
    assert(p.cancelled, 'should be cancelled');
}

#[test]
fn test_cancel_payment_by_owner_after_expiry() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    // Fast-forward past expiry
    start_cheat_block_timestamp_global(NOW + 86401);

    start_cheat_caller_address(dispatcher.contract_address, OWNER());
    dispatcher.cancel_payment(PAYMENT_ID);
    stop_cheat_caller_address(dispatcher.contract_address);

    let p = dispatcher.get_payment(PAYMENT_ID);
    assert(p.cancelled, 'should be cancelled');
}

#[test]
#[should_panic(expected: ('not_expired_yet',))]
fn test_cancel_payment_by_owner_before_expiry() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    start_cheat_caller_address(dispatcher.contract_address, OWNER());
    dispatcher.cancel_payment(PAYMENT_ID);
}

#[test]
#[should_panic(expected: ('unauthorized',))]
fn test_cancel_payment_unauthorized() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    start_cheat_caller_address(dispatcher.contract_address, ALICE());
    dispatcher.cancel_payment(PAYMENT_ID);
}

#[test]
#[should_panic(expected: ('already_cancelled',))]
fn test_cancel_payment_double_cancel() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.cancel_payment(PAYMENT_ID);
    dispatcher.cancel_payment(PAYMENT_ID);
}

#[test]
#[should_panic(expected: ('already_settled',))]
fn test_cancel_payment_already_settled() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.cancel_payment(PAYMENT_ID);
}

#[test]
#[should_panic(expected: ('no_payment',))]
fn test_cancel_nonexistent_payment() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();

    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.cancel_payment('nonexistent');
}

// ===========================================================================
// SET ATTESTOR
// ===========================================================================
#[test]
fn test_set_attestor() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();

    start_cheat_caller_address(dispatcher.contract_address, OWNER());
    dispatcher.set_attestor(ALICE());
    stop_cheat_caller_address(dispatcher.contract_address);

    assert(dispatcher.get_attestor() == ALICE(), 'attestor not updated');
}

#[test]
#[should_panic(expected: ('owner_only',))]
fn test_set_attestor_unauthorized() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();

    start_cheat_caller_address(dispatcher.contract_address, ALICE());
    dispatcher.set_attestor(ALICE());
}

// ===========================================================================
// OWNERSHIP TRANSFER (TWO-STEP)
// ===========================================================================
#[test]
fn test_transfer_ownership_full_flow() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();

    // Step 1: owner proposes
    start_cheat_caller_address(dispatcher.contract_address, OWNER());
    dispatcher.transfer_ownership(ALICE());
    stop_cheat_caller_address(dispatcher.contract_address);

    assert(dispatcher.get_pending_owner() == ALICE(), 'pending not set');

    // Step 2: alice accepts
    start_cheat_caller_address(dispatcher.contract_address, ALICE());
    dispatcher.accept_ownership();
    stop_cheat_caller_address(dispatcher.contract_address);

    // Verify: alice is now owner, pending is cleared
    assert(dispatcher.get_pending_owner() == ZERO(), 'pending not cleared');

    // Alice can now do owner-only actions
    start_cheat_caller_address(dispatcher.contract_address, ALICE());
    dispatcher.set_attestor(MERCHANT()); // should not panic
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
#[should_panic(expected: ('owner_only',))]
fn test_transfer_ownership_unauthorized() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();

    start_cheat_caller_address(dispatcher.contract_address, ALICE());
    dispatcher.transfer_ownership(ALICE());
}

#[test]
#[should_panic(expected: ('not_pending_owner',))]
fn test_accept_ownership_wrong_caller() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();

    start_cheat_caller_address(dispatcher.contract_address, OWNER());
    dispatcher.transfer_ownership(ALICE());
    stop_cheat_caller_address(dispatcher.contract_address);

    // Merchant tries to accept (should fail)
    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.accept_ownership();
}

#[test]
#[should_panic(expected: ('not_pending_owner',))]
fn test_accept_ownership_no_pending() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();

    // No transfer_ownership called, pending is zero
    start_cheat_caller_address(dispatcher.contract_address, ALICE());
    dispatcher.accept_ownership();
}

// ===========================================================================
// WITHDRAW
// ===========================================================================
#[test]
fn test_withdraw() {
    let (dispatcher, token, _) = deploy_bitbridge_usdc();
    let contract_addr = dispatcher.contract_address;
    let contract_bal_before = token.balance_of(contract_addr);

    start_cheat_caller_address(contract_addr, OWNER());
    dispatcher.withdraw(500_000000_u256, ALICE());
    stop_cheat_caller_address(contract_addr);

    let alice_bal = token.balance_of(ALICE());
    assert(alice_bal == 500_000000_u256, 'alice wrong balance');

    let contract_bal_after = token.balance_of(contract_addr);
    assert(contract_bal_after == contract_bal_before - 500_000000_u256, 'contract wrong balance');
}

#[test]
#[should_panic(expected: ('owner_only',))]
fn test_withdraw_unauthorized() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();

    start_cheat_caller_address(dispatcher.contract_address, ALICE());
    dispatcher.withdraw(1_u256, ALICE());
}

// ===========================================================================
// GET PAYMENT — nonexistent
// ===========================================================================
#[test]
#[should_panic(expected: ('no_payment',))]
fn test_get_payment_nonexistent() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    dispatcher.get_payment('does_not_exist');
}

// ===========================================================================
// ORACLE VALIDATION
// ===========================================================================
#[test]
#[should_panic(expected: ('btc_price_stale',))]
fn test_stale_btc_price() {
    let (dispatcher, _, oracle) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    // Set oracle timestamp to be very old (stale)
    oracle.set_price(BTC_USD, 10_000_000_000_000_u128, 8, NOW - 7200, 5);

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
}

#[test]
#[should_panic(expected: ('btc_few_sources',))]
fn test_btc_few_sources() {
    let (dispatcher, _, oracle) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    // Set sources below minimum (3)
    oracle.set_price(BTC_USD, 10_000_000_000_000_u128, 8, NOW, 2);

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
}

#[test]
#[should_panic(expected: ('invalid_price',))]
fn test_zero_btc_price() {
    let (dispatcher, _, oracle) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    oracle.set_price(BTC_USD, 0_u128, 8, NOW, 5);

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
}

#[test]
#[should_panic(expected: ('token_price_stale',))]
fn test_stale_token_price_strk() {
    let (dispatcher, _, oracle) = deploy_bitbridge_strk();

    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.create_payment(MERCHANT(), 200_000000000000000000_u128, PAYMENT_ID, BTC_ADDR, 100_000_u64, false);
    stop_cheat_caller_address(dispatcher.contract_address);

    // BTC price is fresh, but STRK price is stale
    oracle.set_price(STRK_USD, 50_000_000_u128, 8, NOW - 7200, 5);

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
}

#[test]
#[should_panic(expected: ('token_few_sources',))]
fn test_token_few_sources_strk() {
    let (dispatcher, _, oracle) = deploy_bitbridge_strk();

    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.create_payment(MERCHANT(), 200_000000000000000000_u128, PAYMENT_ID, BTC_ADDR, 100_000_u64, false);
    stop_cheat_caller_address(dispatcher.contract_address);

    // STRK price has too few sources
    oracle.set_price(STRK_USD, 50_000_000_u128, 8, NOW, 1);

    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 1, high: 0 }, 100_000_u64, 800_000_u64);
}

// ===========================================================================
// PRIVATE SETTLEMENT (Tier 2.4)
// ===========================================================================

#[test]
fn test_private_payment_stores_flag() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();

    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.create_payment(MERCHANT(), 100_000000_u128, PAYMENT_ID, BTC_ADDR, 100_000_u64, true);
    stop_cheat_caller_address(dispatcher.contract_address);

    let p = dispatcher.get_payment(PAYMENT_ID);
    assert(p.is_private, 'should be private');
}

#[test]
fn test_non_private_payment_default() {
    let (dispatcher, _, _) = deploy_bitbridge_usdc();
    create_test_payment(dispatcher);

    let p = dispatcher.get_payment(PAYMENT_ID);
    assert(!p.is_private, 'should not be private');
}

#[test]
fn test_private_payment_still_transfers_tokens() {
    let (dispatcher, token, _) = deploy_bitbridge_usdc();

    // Create a private payment
    start_cheat_caller_address(dispatcher.contract_address, MERCHANT());
    dispatcher.create_payment(MERCHANT(), 100_000000_u128, PAYMENT_ID, BTC_ADDR, 100_000_u64, true);
    stop_cheat_caller_address(dispatcher.contract_address);

    let merchant_bal_before = token.balance_of(MERCHANT());

    // Settle — real tokens should still transfer even though event hides amount
    start_cheat_caller_address(dispatcher.contract_address, ATTESTOR());
    dispatcher.submit_attestation(PAYMENT_ID, u256 { low: 0xdeadbeef, high: 0 }, 100_000_u64, 800_000_u64);
    stop_cheat_caller_address(dispatcher.contract_address);

    let p = dispatcher.get_payment(PAYMENT_ID);
    assert(p.settled, 'should be settled');

    // Merchant received correct tokens despite event hiding amount
    let merchant_bal_after = token.balance_of(MERCHANT());
    assert(merchant_bal_after > merchant_bal_before, 'no tokens received');
}
