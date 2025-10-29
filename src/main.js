import WDK from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import WalletManagerTron from '@tetherto/wdk-wallet-tron';
import WalletManagerBtc from '@tetherto/wdk-wallet-btc';
import QRCode from 'qrcode';
import CryptoJS from 'crypto-js';

class MultiChainWallet {
    constructor() {
        this.wdk = null;
        this.currentChain = 'ethereum';
        this.accounts = {};
        this.customTokens = this.loadCustomTokens();
        this.chainConfigs = {
            ethereum: {
                name: 'Ethereum',
                currency: 'ETH',
                provider: 'https://eth.drpc.org',
                decimals: 18,
                manager: WalletManagerEvm
            },
            polygon: {
                name: 'Polygon',
                currency: 'MATIC',
                provider: 'https://polygon-rpc.com',
                decimals: 18,
                manager: WalletManagerEvm
            },
            arbitrum: {
                name: 'Arbitrum',
                currency: 'ETH',
                provider: 'https://arb1.arbitrum.io/rpc',
                decimals: 18,
                manager: WalletManagerEvm
            },
            tron: {
                name: 'TRON',
                currency: 'TRX',
                provider: 'https://api.trongrid.io',
                decimals: 6,
                manager: WalletManagerTron
            },
            bitcoin: {
                name: 'Bitcoin',
                currency: 'BTC',
                provider: 'https://blockstream.info/api',
                decimals: 8,
                manager: WalletManagerBtc
            }
        };
        this.defaultTokens = {
            ethereum: [
                { symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, coingeckoId: 'tether' },
                { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, coingeckoId: 'usd-coin' },
                { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, coingeckoId: 'dai' }
            ],
            polygon: [
                { symbol: 'USDT', name: 'Tether USD', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, coingeckoId: 'tether' },
                { symbol: 'USDC', name: 'USD Coin', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', decimals: 6, coingeckoId: 'usd-coin' }
            ]
        };
        // runtime vars
        this.currentMnemonic = null;
        this.encryptionPasswordKey = 'wallet_enc_password'; // not the password itself, just flag
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkExistingWallet();
    }

    setupEventListeners() {
        // Auth buttons
        document.getElementById('create-wallet-btn').addEventListener('click', () => this.createWallet());
        document.getElementById('import-wallet-btn').addEventListener('click', () => this.showImportModal());
        
        // Mnemonic modal
        document.getElementById('copy-mnemonic-btn').addEventListener('click', () => this.copyMnemonic());
        document.getElementById('confirm-mnemonic-btn').addEventListener('click', () => this.confirmMnemonic());
        
        // Import modal
        document.getElementById('cancel-import-btn').addEventListener('click', () => this.hideImportModal());
        document.getElementById('confirm-import-btn').addEventListener('click', () => this.importWallet());
        
        // Chain selector
        document.querySelectorAll('.chain-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchChain(e.target.closest('.chain-btn').dataset.chain));
        });
        
        // Refresh
        document.getElementById('refresh-btn').addEventListener('click', () => this.refreshBalance());
        
        // Quick actions
        document.getElementById('send-btn').addEventListener('click', () => this.showSendModal());
        document.getElementById('receive-btn').addEventListener('click', () => this.showReceiveModal());
        document.getElementById('swap-btn').addEventListener('click', () => this.showSwapModal());
        document.getElementById('add-token-btn').addEventListener('click', () => this.showAddTokenModal());
        document.getElementById('settings-btn').addEventListener('click', () => this.showSettingsModal());
        
        // Send modal
        document.getElementById('close-send-modal').addEventListener('click', () => this.hideSendModal());
        document.getElementById('cancel-send-btn').addEventListener('click', () => this.hideSendModal());
        document.getElementById('confirm-send-btn').addEventListener('click', () => this.sendTransaction());
        document.getElementById('max-btn').addEventListener('click', () => this.setMaxAmount());
        
        // Receive modal
        document.getElementById('close-receive-modal').addEventListener('click', () => this.hideReceiveModal());
        document.getElementById('copy-receive-address').addEventListener('click', () => this.copyReceiveAddress());
        
        // Add token modal
        document.getElementById('close-add-token-modal').addEventListener('click', () => this.hideAddTokenModal());
        document.getElementById('cancel-add-token-btn').addEventListener('click', () => this.hideAddTokenModal());
        document.getElementById('confirm-add-token-btn').addEventListener('click', () => this.addCustomToken());
        
        // Swap modal
        document.getElementById('close-swap-modal').addEventListener('click', () => this.hideSwapModal());
        document.getElementById('cancel-swap-btn').addEventListener('click', () => this.hideSwapModal());
        document.getElementById('confirm-swap-btn').addEventListener('click', () => this.performSwap());
        document.getElementById('swap-reverse').addEventListener('click', () => this.swapReverse());
        
        // Copy address
        document.getElementById('copy-address-btn').addEventListener('click', () => this.copyAddress());

        // Settings modal actions
        document.getElementById('close-settings-modal').addEventListener('click', () => this.hideSettingsModal());
        document.getElementById('save-settings-btn').addEventListener('click', () => this.saveSettings());
        document.getElementById('export-mnemonic-btn').addEventListener('click', () => this.exportMnemonic());
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
    }

    async checkExistingWallet() {
        const savedMnemonicEncrypted = localStorage.getItem('wallet_mnemonic_encrypted');
        const savedMnemonicPlain = localStorage.getItem('wallet_mnemonic_plain');
        const passwdFlag = localStorage.getItem(this.encryptionPasswordKey); // presence indicates user has set password before

        // If encrypted mnemonic exists, ask for password modal (we added a simple flow: settings -> user must have password saved)
        if (savedMnemonicEncrypted && passwdFlag) {
            // show password prompt modal (we'll reuse import modal input for simplicity)
            const pwd = prompt('Enter encryption password to unlock wallet:');
            if (!pwd) {
                this.showToast('Wallet locked. Please enter password in Settings to load.', 'error');
                return;
            }
            try {
                const dec = CryptoJS.AES.decrypt(savedMnemonicEncrypted, pwd).toString(CryptoJS.enc.Utf8);
                if (!dec) throw new Error('Invalid password');
                await this.initializeWallet(dec);
            } catch (err) {
                console.error('Decryption failed', err);
                this.showToast('Invalid password - cannot unlock wallet', 'error');
            }
            return;
        }

        if (savedMnemonicEncrypted && !passwdFlag) {
            // fallback: try decrypt with empty password
            try {
                const dec = CryptoJS.AES.decrypt(savedMnemonicEncrypted, '').toString(CryptoJS.enc.Utf8);
                if (dec) {
                    await this.initializeWallet(dec);
                    return;
                }
            } catch (e) { /* ignore */ }
        }

        if (savedMnemonicPlain) {
            // warning: plaintext mnemonic found (recommend encryption)
            this.showToast('Plaintext mnemonic found in storage. Please set a password in Settings to encrypt it.', 'warning');
            await this.initializeWallet(savedMnemonicPlain);
            return;
        }
    }

    async createWallet() {
        try {
            this.showLoading();
            const mnemonic = WDK.getRandomSeedPhrase();
            
            // Display mnemonic
            this.displayMnemonic(mnemonic);
            this.currentMnemonic = mnemonic;
            
            this.hideLoading();
        } catch (error) {
            console.error('Error creating wallet:', error);
            this.showToast('Failed to create wallet', 'error');
            this.hideLoading();
        }
    }

    displayMnemonic(mnemonic) {
        const words = mnemonic.split(' ');
        const grid = document.getElementById('mnemonic-words');
        grid.innerHTML = '';
        
        words.forEach((word, index) => {
            const wordDiv = document.createElement('div');
            wordDiv.className = 'mnemonic-word';
            wordDiv.innerHTML = `
                <span class="mnemonic-word-number">${index + 1}</span>
                ${word}
            `;
            grid.appendChild(wordDiv);
        });
        
        document.getElementById('mnemonic-modal').classList.add('active');
    }

    copyMnemonic() {
        navigator.clipboard.writeText(this.currentMnemonic);
        this.showToast('Mnemonic copied to clipboard', 'success');
    }

    async confirmMnemonic() {
        document.getElementById('mnemonic-modal').classList.remove('active');

        // If user set password in settings, encrypt before saving
        const pwd = localStorage.getItem('wallet_enc_pass_plain'); // we store only when user sets in current device via settings
        if (pwd) {
            const ciphertext = CryptoJS.AES.encrypt(this.currentMnemonic, pwd).toString();
            localStorage.setItem('wallet_mnemonic_encrypted', ciphertext);
            localStorage.setItem(this.encryptionPasswordKey, '1'); // flag that encryption is used
            // Do NOT keep plaintext
            localStorage.removeItem('wallet_mnemonic_plain');
        } else {
            // store plaintext (but warn)
            localStorage.setItem('wallet_mnemonic_plain', this.currentMnemonic);
            this.showToast('Consider setting a password in Settings to encrypt your mnemonic.', 'warning');
        }

        await this.initializeWallet(this.currentMnemonic);
    }

    showImportModal() {
        document.getElementById('import-modal').classList.add('active');
    }

    hideImportModal() {
        document.getElementById('import-modal').classList.remove('active');
        document.getElementById('import-mnemonic-input').value = '';
    }

    async importWallet() {
        const mnemonic = document.getElementById('import-mnemonic-input').value.trim();
        
        if (!mnemonic) {
            this.showToast('Please enter a mnemonic phrase', 'error');
            return;
        }
        
        this.hideImportModal();

        // Save similarly as confirmMnemonic
        const pwd = localStorage.getItem('wallet_enc_pass_plain');
        if (pwd) {
            const ciphertext = CryptoJS.AES.encrypt(mnemonic, pwd).toString();
            localStorage.setItem('wallet_mnemonic_encrypted', ciphertext);
            localStorage.setItem(this.encryptionPasswordKey, '1');
            localStorage.removeItem('wallet_mnemonic_plain');
        } else {
            localStorage.setItem('wallet_mnemonic_plain', mnemonic);
        }

        await this.initializeWallet(mnemonic);
    }

    async initializeWallet(mnemonic) {
        try {
            this.showLoading();
            
            // Initialize WDK with multiple chains
            this.wdk = new WDK(mnemonic);
            
            // Register all chains
            for (const [chain, config] of Object.entries(this.chainConfigs)) {
                this.wdk.registerWallet(chain, config.manager, {
                    provider: config.provider
                });
            }
            
            // Get accounts for all chains
            for (const chain of Object.keys(this.chainConfigs)) {
                this.accounts[chain] = await this.wdk.getAccount(chain, 0);
            }
            
            // Switch to wallet screen
            document.getElementById('auth-screen').classList.remove('active');
            document.getElementById('wallet-screen').classList.add('active');
            
            // Load wallet data
            await this.loadWalletData();
            
            this.hideLoading();
            this.showToast('Wallet loaded successfully', 'success');
        } catch (error) {
            console.error('Error initializing wallet:', error);
            this.showToast('Failed to initialize wallet', 'error');
            this.hideLoading();
        }
    }

    async loadWalletData() {
        await this.updateBalance();
        await this.updateAddress();
        await this.loadTokens();
    }

    async switchChain(chain) {
        this.currentChain = chain;
        
        // Update active button
        document.querySelectorAll('.chain-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-chain="${chain}"]`).classList.add('active');
        
        // Update UI
        await this.updateBalance();
        await this.updateAddress();
        await this.loadTokens();
    }

    async updateBalance() {
        try {
            const account = this.accounts[this.currentChain];
            const balance = await account.getBalance();
            const config = this.chainConfigs[this.currentChain];
            
            const balanceFormatted = (Number(balance) / Math.pow(10, config.decimals)).toFixed(6);
            
            document.getElementById('balance-amount').textContent = balanceFormatted;
            document.getElementById('balance-currency').textContent = config.currency;
        } catch (error) {
            console.error('Error updating balance:', error);
            document.getElementById('balance-amount').textContent = '0.00';
        }
    }

    async updateAddress() {
        try {
            const account = this.accounts[this.currentChain];
            const address = await account.getAddress();
            
            const shortAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
            document.getElementById('wallet-address').textContent = shortAddress;
            document.getElementById('wallet-address').dataset.fullAddress = address;
        } catch (error) {
            console.error('Error updating address:', error);
        }
    }

    // Fetch token balances and USD price using CoinGecko
    async loadTokens() {
        const tokensList = document.getElementById('tokens-list');
        tokensList.innerHTML = '';
        
        // Get tokens for current chain
        const chainTokens = this.defaultTokens[this.currentChain] || [];
        const customChainTokens = this.customTokens[this.currentChain] || [];
        const allTokens = [...chainTokens, ...customChainTokens];
        
        // Only show tokens for EVM chains
        if (!['ethereum', 'polygon', 'arbitrum'].includes(this.currentChain)) {
            // show native token item for non-EVM
            const li = document.createElement('div');
            li.className = 'token-item';
            li.innerHTML = `<div class="token-info"><div class="token-icon">${this.chainConfigs[this.currentChain].currency.charAt(0)}</div><div class="token-details"><h3>${this.chainConfigs[this.currentChain].currency}</h3><p>Native Balance</p></div></div><div class="token-balance"><div class="token-balance-amount" id="native-balance-item">—</div></div>`;
            tokensList.appendChild(li);
            // set balance
            try {
                const account = this.accounts[this.currentChain];
                const balance = await account.getBalance();
                const config = this.chainConfigs[this.currentChain];
                const balanceFormatted = (Number(balance) / Math.pow(10, config.decimals)).toFixed(6);
                document.getElementById('native-balance-item').textContent = `${balanceFormatted}`;
            } catch(e){}
            return;
        }
        
        // collect coingecko ids for batch price fetch
        const cgIds = [];
        allTokens.forEach(t => { if (t.coingeckoId) cgIds.push(t.coingeckoId); });
        // unique
        const uniqueIds = [...new Set(cgIds)];
        let priceMap = {};
        if (uniqueIds.length) {
            try {
                const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${uniqueIds.join(',')}&vs_currencies=usd`);
                const json = await res.json();
                priceMap = json; // { id: { usd: 1.00 } }
            } catch (e) {
                console.warn('Price fetch failed', e);
            }
        }
        
        for (const token of allTokens) {
            try {
                const account = this.accounts[this.currentChain];
                const balance = await account.getTokenBalance(token.address);
                const balanceFormatted = (Number(balance) / Math.pow(10, token.decimals)).toFixed(4);
                
                const usdPrice = token.coingeckoId && priceMap[token.coingeckoId] ? priceMap[token.coingeckoId].usd : 0;
                const usdValue = (Number(balanceFormatted) * Number(usdPrice)).toFixed(2);
                
                const tokenItem = document.createElement('div');
                tokenItem.className = 'token-item';
                tokenItem.innerHTML = `
                    <div class="token-info">
                        <div class="token-icon">${token.symbol.charAt(0)}</div>
                        <div class="token-details">
                            <h3>${token.symbol}</h3>
                            <p>${token.name}</p>
                        </div>
                    </div>
                    <div class="token-balance">
                        <div class="token-balance-amount">${balanceFormatted}</div>
                        <div class="token-balance-usd">$${usdValue}</div>
                    </div>
                `;
                tokensList.appendChild(tokenItem);
            } catch (error) {
                console.error(`Error loading token ${token.symbol}:`, error);
            }
        }
    }

    async refreshBalance() {
        const btn = document.getElementById('refresh-btn');
        btn.style.transform = 'rotate(360deg)';
        
        await this.loadWalletData();
        
        setTimeout(() => {
            btn.style.transform = 'rotate(0deg)';
        }, 500);
        
        this.showToast('Balance updated', 'success');
    }

    showSendModal() {
        // Populate token select
        const select = document.getElementById('send-token-select');
        select.innerHTML = '<option value="native">Native Token</option>';
        
        const chainTokens = this.defaultTokens[this.currentChain] || [];
        const customChainTokens = this.customTokens[this.currentChain] || [];
        const allTokens = [...chainTokens, ...customChainTokens];
        
        allTokens.forEach(token => {
            const option = document.createElement('option');
            option.value = JSON.stringify(token);
            option.textContent = token.symbol;
    
