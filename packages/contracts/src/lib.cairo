// BitBridge Pay: Payment/Escrow contract (Starknet v1)
// - Merchant creates payment request; relayer submits attestation after BTC confirmation.
// - Settlement is attestation-based; only the contract releases funds when attestation is valid.
// - Uses Pragma oracle for BTC/USD and STRK/USD to compute settlement amount on attestation.

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
        btc_txid: felt252,
        btc_amount_sats: u64,
        btc_block_height: u64,
    );
    fn cancel_payment(ref self: TContractState, payment_id: felt252);
    fn get_payment(self: @TContractState, payment_id: felt252) -> BitBridgePay::Payment;
    fn set_attestor(ref self: TContractState, new_attestor: ContractAddress);
    fn get_attestor(self: @TContractState) -> ContractAddress;
    fn get_oracle_address(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
mod BitBridgePay {
    use core::integer::u256;
    use core::traits::Into;
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    const MAX_STALENESS: u64 = 3600_u64;
    const PAYMENT_TTL: u64 = 86400_u64; // 24 hours in seconds
    const MIN_BTC_CONFIRMATIONS: u64 = 6_u64; // enforced off-chain for now, used in 1.3

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

    #[storage]
    struct Storage {
        payments: Map<felt252, Payment>,
        attestor: ContractAddress,
        oracle_address: ContractAddress,
        owner: ContractAddress,
    }

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
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PaymentCreated: PaymentCreated,
        PaymentSettled: PaymentSettled,
        PaymentCancelled: PaymentCancelled,
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
        pub btc_txid: felt252,
    }
    #[derive(Drop, starknet::Event)]
    pub struct PaymentCancelled {
        #[key]
        pub payment_id: felt252,
        pub merchant: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        attestor: ContractAddress,
        oracle_address: ContractAddress,
        owner: ContractAddress,
    ) {
        self.owner.write(owner);
        self.attestor.write(attestor);
        self.oracle_address.write(oracle_address);
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
            btc_txid: felt252,
            btc_amount_sats: u64,
            btc_block_height: u64,
        ) {
            self._submit_attestation(payment_id, btc_txid, btc_amount_sats, btc_block_height);
        }
        // Allow cancellation of payment
        fn cancel_payment(ref self: ContractState, payment_id: felt252) {
            let mut payment = self.payments.entry(payment_id).read();
            assert(payment.initialized, 'no_payment');
            assert(!payment.settled, 'already_settled');
            assert(!payment.cancelled, 'already_cancelled');
            let now = starknet::get_block_timestamp();
            assert(now > payment.expires_at, 'not_expired_yet');
            // only merchant or owner can cancel
            let caller = get_caller_address();
            assert(caller == payment.merchant || caller == self.owner.read(), 'unauthorized');
            // mark as cancelled
            let merchant = payment.merchant;
            payment.cancelled = true;
            self.payments.entry(payment_id).write(payment);
            self.emit(PaymentCancelled { payment_id, merchant });
        }
        fn set_attestor(ref self: ContractState, new_attestor: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'owner_only');
            self.attestor.write(new_attestor);
        }

        fn get_payment(self: @ContractState, payment_id: felt252) -> Payment {
            self._get_payment_or_panic(payment_id)
        }

        fn get_attestor(self: @ContractState) -> ContractAddress {
            self.attestor.read()
        }

        fn get_oracle_address(self: @ContractState) -> ContractAddress {
            self.oracle_address.read()
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
            btc_txid: felt252,
            btc_amount_sats: u64,
            btc_block_height: u64,
        ) {
            let caller = get_caller_address();
            let now = starknet::get_block_timestamp();
            assert(caller == self.attestor.read(), 'attestor_only');

            let mut payment = self.payments.entry(payment_id).read();
            assert(!payment.settled, 'already_settled');
            assert(btc_amount_sats >= payment.required_btc_sats, 'btc_below_required');
            assert(now <= payment.expires_at, 'payment_expired');
            assert(!payment.cancelled, 'payment_cancelled');
            // validate minimum confirmations before anything else
            // NOTE: BTC confirmation depth is enforced off-chain by the attestor.
            // btc_block_height is stored for auditability.
            // On-chain confirmation validation requires attestor to pass current BTC
            // chain tip as a parameter — deferred to Milestone 1.3.
            let merchant = payment.merchant;
            // Get prices from Pragma oracle (on-chain only for settlement)
            let amount_settlement_units = self
                ._compute_settlement_amount_from_oracle(btc_amount_sats);
            let slippage_floor: u256 = (payment.amount_settlement_units * 95_u128 / 100_u128)
                .into();
            assert(amount_settlement_units >= slippage_floor, 'price_slippage_exceeded');

            payment.settled = true;
            payment.btc_block_height = btc_block_height;
            self.payments.entry(payment_id).write(payment);

            self.emit(PaymentSettled { payment_id, merchant, amount_settlement_units, btc_txid });
            // TODO (Milestone 1.3): Transfer amount_settlement_units (STRK or USDC)
        // to payment.merchant via token contract. For now we only record settlement.
        }

        /// Fetches spot median price from Pragma for the given pair_id (e.g. 'BTC/USD',
        /// 'STRK/USD').
        fn _get_pragma_price(self: @ContractState, pair_id: felt252) -> PragmaPricesResponse {
            let oracle_address = self.oracle_address.read();
            let dispatcher = IPragmaOracleReaderDispatcher { contract_address: oracle_address };
            dispatcher.get_data_median(PragmaDataType::SpotEntry(pair_id))
        }

        /// Computes settlement amount in STRK (or settlement token) base units from btc_amount_sats
        /// BTC -> USD -> STRK
        /// using Pragma BTC/USD and STRK/USD. Formula:
        /// (btc_sats * btc_usd_price * 10^strk_dec) / (10^8 * 10^btc_dec * strk_usd_price).
        fn _compute_settlement_amount_from_oracle(
            self: @ContractState, btc_amount_sats: u64,
        ) -> u256 {
            const BTC_USD: felt252 = 'BTC/USD';
            const STRK_USD: felt252 = 'STRK/USD';
            const SATS_PER_BTC: u128 = 100000000; // 10^8

            let btc_resp: PragmaPricesResponse = self._get_pragma_price(BTC_USD);
            let strk_resp: PragmaPricesResponse = self._get_pragma_price(STRK_USD);
            let current_time = starknet::get_block_timestamp();
            assert(
                current_time - btc_resp.last_updated_timestamp < MAX_STALENESS, 'btc_price_stale',
            );

            assert(
                current_time - strk_resp.last_updated_timestamp < MAX_STALENESS, 'strk_price_stale',
            );
            let btc_price: u128 = btc_resp.price;
            let strk_price: u128 = strk_resp.price;
            assert(btc_price > 0_u128, 'invalid_btc_price');
            assert(strk_price > 0_u128, 'invalid_strk_price');

            let btc_dec = btc_resp.decimals;
            let strk_dec = strk_resp.decimals;

            // value_usd_scaled = btc_amount_sats * btc_price (in oracle decimals)
            // Then divide by SATS_PER_BTC and 10^btc_dec to get USD value.
            // amount_strk = value_usd * 10^strk_dec / strk_price
            // So: amount_strk = (btc_amount_sats * btc_price * 10^strk_dec) / (SATS_PER_BTC *
            // 10^btc_dec * strk_price)
            let btc_dec_factor = _pow10(btc_dec);
            let strk_dec_factor = _pow10(strk_dec);
            let sats_u128: u128 = Into::into(btc_amount_sats);
            let sats_u256: u256 = sats_u128.into();
            let numerator = sats_u256 * btc_price.into() * strk_dec_factor.into();
            let denominator = SATS_PER_BTC.into() * btc_dec_factor.into() * strk_price.into();
            numerator / denominator
        }

        fn _get_payment_or_panic(self: @ContractState, payment_id: felt252) -> Payment {
            let payment = self.payments.entry(payment_id).read();
            assert(payment.initialized, 'no_payment');
            payment
        }
    }

    /// Returns 10^decimals as u128. Supports common oracle decimals (5, 8, 18).
    fn _pow10(decimals: u32) -> u128 {
        if decimals == 5 {
            100000_u128
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
