// BitBridge Pay: Payment/Escrow contract (Starknet v1)
// - Merchant creates payment request; relayer submits attestation after BTC confirmation.
// - Settlement is attestation-based; only the contract releases funds when attestation is valid.
// - Uses Pragma oracle for BTC/USD and (optionally) token/USD to compute settlement amount.
//
// settlement_pair_id == 0  →  USD-pegged settlement token (e.g. USDC). Only BTC/USD oracle used.
// settlement_pair_id != 0  →  Token with its own oracle (e.g. 'STRK/USD'). Both oracles used.

use starknet::ContractAddress;

#[starknet::interface]
trait IBitBridgePay<TContractState> {
    fn create_payment(
        ref self: TContractState,
        merchant: ContractAddress,
        amount_settlement_units: u128,
        payment_id: felt252,
        btc_address: felt252,
        required_btc_sats: u64,
    );
    fn submit_attestation(
        ref self: TContractState,
        payment_id: felt252,
        btc_txid: u256,
        btc_amount_sats: u64,
        btc_block_height: u64,
    );
    fn cancel_payment(ref self: TContractState, payment_id: felt252);
    fn get_payment(self: @TContractState, payment_id: felt252) -> BitBridgePay::Payment;
    // Attestor management
    fn set_attestor(ref self: TContractState, new_attestor: ContractAddress);
    fn get_attestor(self: @TContractState) -> ContractAddress;
    // Ownership transfer (two-step)
    fn transfer_ownership(ref self: TContractState, new_owner: ContractAddress);
    fn accept_ownership(ref self: TContractState);
    fn get_pending_owner(self: @TContractState) -> ContractAddress;
    // Token recovery
    fn withdraw(ref self: TContractState, amount: u256, recipient: ContractAddress);
    // View: configuration
    fn get_oracle_address(self: @TContractState) -> ContractAddress;
    fn get_settlement_token(self: @TContractState) -> ContractAddress;
    fn get_settlement_pair_id(self: @TContractState) -> felt252;
    fn get_settlement_token_decimals(self: @TContractState) -> u32;
}

#[starknet::contract]
mod BitBridgePay {
    use core::integer::u256;
    use core::traits::Into;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    const MAX_STALENESS: u64 = 3600_u64; // 1 hour
    const PAYMENT_TTL: u64 = 86400_u64; // 24 hours in seconds
    const MIN_BTC_CONFIRMATIONS: u64 = 6_u64; // enforced off-chain for now, used in 1.3
    const MIN_ORACLE_SOURCES: u32 = 3_u32; // minimum Pragma sources required for price validity

    // ABI-compatible with Pragma oracle (so we can call get_data_median without pragma_lib
    // dependency).
    #[derive(Drop, Copy, Serde)]
    enum PragmaDataType {
        SpotEntry: felt252,
    }
    #[derive(Drop, Copy, Serde)]
    struct PragmaPricesResponse {
        price: u128,
        decimals: u32,
        last_updated_timestamp: u64,
        num_sources_aggregated: u32,
    }

    /// Minimal interface to call Pragma oracle get_data_median (same selector as Pragma contract).
    #[starknet::interface]
    trait IPragmaOracleReader<TContractState> {
        fn get_data_median(
            self: @TContractState, data_type: PragmaDataType,
        ) -> PragmaPricesResponse;
    }

    /// Minimal ERC20 interface: transfer tokens from self (caller) to recipient.
    /// When this contract calls it, the contract's token balance is debited.
    #[starknet::interface]
    trait ISettlementToken<TContractState> {
        fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256);
    }

    #[storage]
    struct Storage {
        payments: Map<felt252, Payment>,
        attestor: ContractAddress,
        oracle_address: ContractAddress,
        owner: ContractAddress,
        /// Pending owner address during a two-step ownership transfer. Zero when no transfer is
        /// in progress.
        pending_owner: ContractAddress,
        settlement_token: ContractAddress,
        /// Pragma pair id for the settlement token (e.g. 'STRK/USD').
        /// Set to 0 for USD-pegged tokens (e.g. USDC) — no second oracle query needed.
        settlement_pair_id: felt252,
        /// ERC20 decimal precision of the settlement token (e.g. 18 for STRK, 6 for USDC).
        settlement_token_decimals: u32,
    }

    /// Stored on-chain for every payment. btc_txid is zero until settled.
    #[derive(Drop, Serde, starknet::Store)]
    pub struct Payment {
        pub initialized: bool,
        pub merchant: ContractAddress,
        pub amount_settlement_units: u128,
        pub btc_address: felt252,
        pub required_btc_sats: u64,
        pub settled: bool,
        pub expires_at: u64,
        pub btc_block_height: u64,
        pub cancelled: bool,
        /// The Bitcoin transaction id that settled this payment. Zero until settled.
        pub btc_txid: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PaymentCreated: PaymentCreated,
        PaymentSettled: PaymentSettled,
        PaymentCancelled: PaymentCancelled,
        AttestorUpdated: AttestorUpdated,
        OwnershipTransferProposed: OwnershipTransferProposed,
        OwnershipTransferred: OwnershipTransferred,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PaymentCreated {
        #[key]
        pub payment_id: felt252,
        pub merchant: ContractAddress,
        pub btc_address: felt252,
        pub required_btc_sats: u64,
        pub amount_settlement_units: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PaymentSettled {
        #[key]
        pub payment_id: felt252,
        pub merchant: ContractAddress,
        pub amount_settlement_units: u256,
        pub btc_txid: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PaymentCancelled {
        #[key]
        pub payment_id: felt252,
        pub merchant: ContractAddress,
    }

    /// Emitted whenever the attestor address is changed by the owner.
    #[derive(Drop, starknet::Event)]
    pub struct AttestorUpdated {
        pub old_attestor: ContractAddress,
        pub new_attestor: ContractAddress,
    }

    /// Emitted when the owner proposes a new owner (step 1 of two-step transfer).
    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferProposed {
        pub current_owner: ContractAddress,
        pub proposed_owner: ContractAddress,
    }

    /// Emitted when the proposed owner accepts ownership (step 2 of two-step transfer).
    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferred {
        pub old_owner: ContractAddress,
        pub new_owner: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        attestor: ContractAddress,
        oracle_address: ContractAddress,
        owner: ContractAddress,
        settlement_token: ContractAddress,
        settlement_pair_id: felt252,
        settlement_token_decimals: u32,
    ) {
        self.owner.write(owner);
        self.attestor.write(attestor);
        self.oracle_address.write(oracle_address);
        self.settlement_token.write(settlement_token);
        self.settlement_pair_id.write(settlement_pair_id);
        self.settlement_token_decimals.write(settlement_token_decimals);
    }

    #[abi(embed_v0)]
    impl BitBridgePayImpl of super::IBitBridgePay<ContractState> {
        fn create_payment(
            ref self: ContractState,
            merchant: ContractAddress,
            amount_settlement_units: u128,
            payment_id: felt252,
            btc_address: felt252,
            required_btc_sats: u64,
        ) {
            self
                ._create_payment(
                    merchant, amount_settlement_units, payment_id, btc_address, required_btc_sats,
                );
        }

        fn submit_attestation(
            ref self: ContractState,
            payment_id: felt252,
            btc_txid: u256,
            btc_amount_sats: u64,
            btc_block_height: u64,
        ) {
            self._submit_attestation(payment_id, btc_txid, btc_amount_sats, btc_block_height);
        }

        fn cancel_payment(ref self: ContractState, payment_id: felt252) {
            let mut payment = self.payments.entry(payment_id).read();
            assert(payment.initialized, 'no_payment');
            assert(!payment.settled, 'already_settled');
            assert(!payment.cancelled, 'already_cancelled');

            let caller = get_caller_address();
            if caller == payment.merchant {
                // Merchant can cancel their own payment at any time — pre- or post-expiry.
                // Useful when a wrong BTC address was given or the customer won't pay.
            } else {
                // Non-merchant callers (e.g. owner doing cleanup) may only cancel after expiry.
                assert(caller == self.owner.read(), 'unauthorized');
                let now = starknet::get_block_timestamp();
                assert(now > payment.expires_at, 'not_expired_yet');
            }

            let merchant = payment.merchant;
            payment.cancelled = true;
            self.payments.entry(payment_id).write(payment);
            self.emit(PaymentCancelled { payment_id, merchant });
        }

        fn set_attestor(ref self: ContractState, new_attestor: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'owner_only');
            let old_attestor = self.attestor.read();
            self.attestor.write(new_attestor);
            self.emit(AttestorUpdated { old_attestor, new_attestor });
        }

        /// Step 1: current owner proposes a new owner. The new owner must call accept_ownership.
        /// Using two steps prevents ownership being accidentally transferred to an uncontrolled
        /// address (e.g. a mistyped address would never be able to call accept_ownership).
        fn transfer_ownership(ref self: ContractState, new_owner: ContractAddress) {
            let caller = get_caller_address();
            assert(caller == self.owner.read(), 'owner_only');
            self.pending_owner.write(new_owner);
            self.emit(OwnershipTransferProposed { current_owner: caller, proposed_owner: new_owner });
        }

        /// Step 2: proposed owner accepts. Only they can call this.
        fn accept_ownership(ref self: ContractState) {
            let caller = get_caller_address();
            let pending = self.pending_owner.read();
            assert(caller == pending, 'not_pending_owner');
            let old_owner = self.owner.read();
            self.owner.write(caller);
            // Clear pending so accept can't be replayed.
            self.pending_owner.write(starknet::contract_address_const::<0>());
            self.emit(OwnershipTransferred { old_owner, new_owner: caller });
        }

        /// Owner can withdraw settlement tokens from the contract.
        /// Covers expired payments whose tokens were never claimed and emergency recovery.
        fn withdraw(ref self: ContractState, amount: u256, recipient: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'owner_only');
            let token = self.settlement_token.read();
            let dispatcher = ISettlementTokenDispatcher { contract_address: token };
            dispatcher.transfer(recipient, amount);
        }

        fn get_payment(self: @ContractState, payment_id: felt252) -> Payment {
            self._get_payment_or_panic(payment_id)
        }

        fn get_attestor(self: @ContractState) -> ContractAddress {
            self.attestor.read()
        }

        fn get_pending_owner(self: @ContractState) -> ContractAddress {
            self.pending_owner.read()
        }

        fn get_oracle_address(self: @ContractState) -> ContractAddress {
            self.oracle_address.read()
        }

        fn get_settlement_token(self: @ContractState) -> ContractAddress {
            self.settlement_token.read()
        }

        fn get_settlement_pair_id(self: @ContractState) -> felt252 {
            self.settlement_pair_id.read()
        }

        fn get_settlement_token_decimals(self: @ContractState) -> u32 {
            self.settlement_token_decimals.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _create_payment(
            ref self: ContractState,
            merchant: ContractAddress,
            amount_settlement_units: u128,
            payment_id: felt252,
            btc_address: felt252,
            required_btc_sats: u64,
        ) {
            // Only the merchant wallet may open a payment on their own behalf.
            // Prevents griefing: a third party cannot pre-fill payment IDs for a merchant
            // or create fake payment requests pointing to an arbitrary BTC address.
            assert(get_caller_address() == merchant, 'caller_must_be_merchant');
            assert(amount_settlement_units > 0, 'amt_pos');
            assert(required_btc_sats > 0, 'req_btc_pos');

            let existing = self.payments.entry(payment_id).read();
            assert(!existing.initialized, 'payment_id_exists');

            let now = starknet::get_block_timestamp();
            self
                .payments
                .entry(payment_id)
                .write(
                    Payment {
                        initialized: true,
                        merchant,
                        amount_settlement_units,
                        btc_address,
                        required_btc_sats,
                        settled: false,
                        expires_at: now + PAYMENT_TTL,
                        btc_block_height: 0,
                        cancelled: false,
                        btc_txid: u256 { low: 0, high: 0 },
                    },
                );

            self
                .emit(
                    PaymentCreated {
                        payment_id,
                        merchant,
                        btc_address,
                        required_btc_sats,
                        amount_settlement_units,
                    },
                );
        }

        fn _submit_attestation(
            ref self: ContractState,
            payment_id: felt252,
            btc_txid: u256,
            btc_amount_sats: u64,
            btc_block_height: u64,
        ) {
            let caller = get_caller_address();
            let now = starknet::get_block_timestamp();
            assert(caller == self.attestor.read(), 'attestor_only');

            let mut payment = self.payments.entry(payment_id).read();
            assert(payment.initialized, 'payment_not_initialized');
            assert(!payment.settled, 'already_settled');
            assert(!payment.cancelled, 'payment_cancelled');
            assert(btc_amount_sats >= payment.required_btc_sats, 'btc_below_required');
            assert(now <= payment.expires_at, 'payment_expired');
            // NOTE: BTC confirmation depth is enforced off-chain by the attestor.
            // btc_block_height is stored for auditability.
            // On-chain confirmation validation (M1.3) will require the attestor to pass
            // the current BTC chain tip as a parameter.

            let merchant = payment.merchant;
            let amount_settlement_units = self
                ._compute_settlement_amount_from_oracle(btc_amount_sats);
            let slippage_floor: u256 = (payment.amount_settlement_units * 95_u128 / 100_u128)
                .into();
            assert(amount_settlement_units >= slippage_floor, 'price_slippage_exceeded');

            payment.settled = true;
            payment.btc_block_height = btc_block_height;
            payment.btc_txid = btc_txid;
            self.payments.entry(payment_id).write(payment);

            self.emit(PaymentSettled { payment_id, merchant, amount_settlement_units, btc_txid });

            // Release settlement token to merchant. Contract must hold sufficient balance
            // (funded off-chain before any payment is created).
            let token = self.settlement_token.read();
            let dispatcher = ISettlementTokenDispatcher { contract_address: token };
            dispatcher.transfer(merchant, amount_settlement_units);
        }

        /// Fetches a spot median price from Pragma for the given pair_id.
        fn _get_pragma_price(self: @ContractState, pair_id: felt252) -> PragmaPricesResponse {
            let oracle_address = self.oracle_address.read();
            let dispatcher = IPragmaOracleReaderDispatcher { contract_address: oracle_address };
            dispatcher.get_data_median(PragmaDataType::SpotEntry(pair_id))
        }

        /// Validates a Pragma price response:
        /// - Staleness: uses addition (`last_updated + MAX_STALENESS >= now`) to avoid u64
        ///   underflow if the oracle ever returns a future timestamp.
        /// - Source count: at least MIN_ORACLE_SOURCES aggregated, making single-source
        ///   price manipulation much harder.
        /// - Non-zero price.
        fn _validate_pragma_price(
            self: @ContractState,
            resp: PragmaPricesResponse,
            current_time: u64,
            stale_err: felt252,
            sources_err: felt252,
        ) {
            assert(resp.last_updated_timestamp + MAX_STALENESS >= current_time, stale_err);
            assert(resp.num_sources_aggregated >= MIN_ORACLE_SOURCES, sources_err);
            assert(resp.price > 0_u128, 'invalid_price');
        }

        /// Computes the settlement amount in token base units from btc_amount_sats.
        ///
        /// Two paths:
        ///
        /// USD-pegged token (settlement_pair_id == 0, e.g. USDC with 6 decimals):
        ///   Only BTC/USD oracle needed. USD value is scaled to token decimals directly.
        ///   amount = (sats * btc_price * 10^token_dec) / (SATS_PER_BTC * 10^btc_oracle_dec)
        ///
        /// Token with its own oracle (settlement_pair_id != 0, e.g. STRK with 18 decimals):
        ///   Both BTC/USD and token/USD oracles are used.
        ///   amount = (sats * btc_price * 10^token_oracle_dec * 10^token_dec)
        ///            / (SATS_PER_BTC * 10^btc_oracle_dec * token_price)
        ///
        /// Note: oracle `decimals` fields are the price precision (e.g. 8 for Pragma).
        ///       `settlement_token_decimals` is the ERC20 token precision (e.g. 18 for STRK).
        ///       These are independent and both must be factored in for a correct result.
        fn _compute_settlement_amount_from_oracle(
            self: @ContractState, btc_amount_sats: u64,
        ) -> u256 {
            const BTC_USD: felt252 = 'BTC/USD';
            const SATS_PER_BTC: u128 = 100000000; // 10^8

            let current_time = starknet::get_block_timestamp();

            let btc_resp: PragmaPricesResponse = self._get_pragma_price(BTC_USD);
            self
                ._validate_pragma_price(
                    btc_resp, current_time, 'btc_price_stale', 'btc_few_sources',
                );

            let btc_price: u128 = btc_resp.price;
            let btc_oracle_dec_factor: u128 = _pow10(btc_resp.decimals);
            let token_dec_factor: u128 = _pow10(self.settlement_token_decimals.read());
            let sats_u256: u256 = Into::<u64, u128>::into(btc_amount_sats).into();

            let settlement_pair_id = self.settlement_pair_id.read();
            if settlement_pair_id == 0 {
                // USD-pegged token (e.g. USDC): no second oracle needed.
                // amount = (sats * btc_price * 10^token_dec) / (SATS_PER_BTC * 10^btc_oracle_dec)
                let numerator: u256 = sats_u256 * btc_price.into() * token_dec_factor.into();
                let denominator: u256 = SATS_PER_BTC.into() * btc_oracle_dec_factor.into();
                numerator / denominator
            } else {
                // Token with oracle (e.g. STRK/USD):
                // amount = (sats * btc_price * 10^token_oracle_dec * 10^token_dec)
                //          / (SATS_PER_BTC * 10^btc_oracle_dec * token_price)
                let token_resp: PragmaPricesResponse = self._get_pragma_price(settlement_pair_id);
                self
                    ._validate_pragma_price(
                        token_resp, current_time, 'token_price_stale', 'token_few_sources',
                    );

                let token_price: u128 = token_resp.price;
                let token_oracle_dec_factor: u128 = _pow10(token_resp.decimals);

                let numerator: u256 = sats_u256
                    * btc_price.into()
                    * token_oracle_dec_factor.into()
                    * token_dec_factor.into();
                let denominator: u256 = SATS_PER_BTC.into()
                    * btc_oracle_dec_factor.into()
                    * token_price.into();
                numerator / denominator
            }
        }

        fn _get_payment_or_panic(self: @ContractState, payment_id: felt252) -> Payment {
            let payment = self.payments.entry(payment_id).read();
            assert(payment.initialized, 'no_payment');
            payment
        }
    }

    /// Returns 10^decimals as u128. Supports common oracle and token decimals (5, 6, 8, 18).
    fn _pow10(decimals: u32) -> u128 {
        if decimals == 5 {
            100000_u128
        } else if decimals == 6 {
            1000000_u128
        } else if decimals == 8 {
            100000000_u128
        } else if decimals == 18 {
            1000000000000000000_u128
        } else {
            assert(false, 'unsupported_decimals');
            // unreachable, but satisfies compiler
            0_u128
        }
    }
}
