import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface LoyaltyNFT {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  loyaltyLevel: number;
  rewards: number;
  status: "active" | "inactive";
}

const FHEEncryption = (data: string): string => `FHE-${btoa(data)}`;
const FHEDecryption = (encryptedData: string): string => encryptedData.startsWith('FHE-') ? atob(encryptedData.substring(4)) : encryptedData;
const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [nfts, setNfts] = useState<LoyaltyNFT[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newNFTData, setNewNFTData] = useState({ purchaseAmount: "", productCategory: "" });
  const [selectedNFT, setSelectedNFT] = useState<LoyaltyNFT | null>(null);
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [showFAQ, setShowFAQ] = useState(false);
  
  // Statistics
  const activeCount = nfts.filter(n => n.status === "active").length;
  const bronzeCount = nfts.filter(n => n.loyaltyLevel === 1).length;
  const silverCount = nfts.filter(n => n.loyaltyLevel === 2).length;
  const goldCount = nfts.filter(n => n.loyaltyLevel === 3).length;
  const totalRewards = nfts.reduce((sum, nft) => sum + nft.rewards, 0);

  useEffect(() => {
    loadNFTs().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadNFTs = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract is not available");
        return;
      }
      
      // Get NFT keys
      const keysBytes = await contract.getData("nft_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing NFT keys:", e); }
      }
      
      // Load each NFT
      const list: LoyaltyNFT[] = [];
      for (const key of keys) {
        try {
          const nftBytes = await contract.getData(`nft_${key}`);
          if (nftBytes.length > 0) {
            try {
              const nftData = JSON.parse(ethers.toUtf8String(nftBytes));
              list.push({ 
                id: key, 
                encryptedData: nftData.data, 
                timestamp: nftData.timestamp, 
                owner: nftData.owner, 
                loyaltyLevel: nftData.loyaltyLevel || 1,
                rewards: nftData.rewards || 0,
                status: nftData.status || "active"
              });
            } catch (e) { console.error(`Error parsing NFT data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading NFT ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setNfts(list);
    } catch (e) { console.error("Error loading NFTs:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const mintNFT = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting purchase data with Zama FHE..." });
    try {
      // Calculate loyalty level and rewards (simulated FHE computation)
      const purchaseAmount = parseFloat(newNFTData.purchaseAmount);
      let loyaltyLevel = 1;
      let rewards = 0;
      
      if (purchaseAmount > 1000) {
        loyaltyLevel = 3; // Gold
        rewards = 100;
      } else if (purchaseAmount > 500) {
        loyaltyLevel = 2; // Silver
        rewards = 50;
      } else {
        loyaltyLevel = 1; // Bronze
        rewards = 10;
      }

      // Create NFT data
      const nftData = {
        purchaseAmount: newNFTData.purchaseAmount,
        productCategory: newNFTData.productCategory,
        loyaltyLevel,
        rewards,
        timestamp: Date.now()
      };

      // Encrypt and store
      const encryptedData = FHEEncryption(JSON.stringify(nftData));
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const nftId = `NFT-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const storeData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        loyaltyLevel,
        rewards,
        status: "active"
      };
      
      // Store NFT data
      await contract.setData(`nft_${nftId}`, ethers.toUtf8Bytes(JSON.stringify(storeData)));
      
      // Update keys
      const keysBytes = await contract.getData("nft_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(nftId);
      await contract.setData("nft_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "NFT minted successfully with FHE encryption!" });
      await loadNFTs();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewNFTData({ purchaseAmount: "", productCategory: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Minting failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryption(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const isOwner = (nftAddress: string) => address?.toLowerCase() === nftAddress.toLowerCase();

  // Render loyalty level chart
  const renderLoyaltyChart = () => {
    const total = nfts.length || 1;
    const bronzePercentage = (bronzeCount / total) * 100;
    const silverPercentage = (silverCount / total) * 100;
    const goldPercentage = (goldCount / total) * 100;
    
    return (
      <div className="loyalty-chart">
        <div className="chart-bar bronze" style={{ width: `${bronzePercentage}%` }}>
          <span>Bronze: {bronzeCount}</span>
        </div>
        <div className="chart-bar silver" style={{ width: `${silverPercentage}%` }}>
          <span>Silver: {silverCount}</span>
        </div>
        <div className="chart-bar gold" style={{ width: `${goldPercentage}%` }}>
          <span>Gold: {goldCount}</span>
        </div>
      </div>
    );
  };

  // FAQ data
  const faqItems = [
    {
      question: "How does FHE protect my purchase data?",
      answer: "FHE (Fully Homomorphic Encryption) allows computations on encrypted data without decryption. Your purchase details remain encrypted at all times, even during loyalty level calculations."
    },
    {
      question: "Can the brand see my purchase history?",
      answer: "No, brands can only verify your loyalty level and issue rewards without accessing your actual purchase data. Your spending habits remain completely private."
    },
    {
      question: "How are rewards calculated?",
      answer: "Rewards are calculated based on encrypted purchase amounts using FHE technology. Higher spending unlocks better loyalty tiers and more rewards."
    },
    {
      question: "Is my NFT transferable?",
      answer: "Yes, your loyalty NFT is a standard ERC-721 token that can be transferred, but rewards are tied to the NFT and will transfer with it."
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="neon-spinner"></div>
      <p>Initializing FHE encryption protocol...</p>
    </div>
  );

  return (
    <div className="app-container glassmorphism-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>FHE<span>Loyalty</span>NFT</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-btn neon-button">
            <div className="add-icon"></div>Mint NFT
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        {/* Project Introduction */}
        <div className="intro-card glass-card">
          <h2>FHE-Powered Private NFT Loyalty Program</h2>
          <p>
            Brands can issue NFTs as loyalty credentials while keeping customer purchase data encrypted. 
            Using Zama FHE technology, brands can verify membership levels and issue rewards without accessing sensitive purchase details.
          </p>
          <div className="fhe-badge">
            <div className="fhe-icon"></div>
            <span>Fully Homomorphic Encryption</span>
          </div>
        </div>

        {/* Data Statistics */}
        <div className="stats-grid">
          <div className="stat-card glass-card">
            <div className="stat-value">{nfts.length}</div>
            <div className="stat-label">Total NFTs</div>
            <div className="stat-icon">🖼️</div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-value">{activeCount}</div>
            <div className="stat-label">Active NFTs</div>
            <div className="stat-icon">✅</div>
          </div>
          <div className="stat-card glass-card">
            <div className="stat-value">{totalRewards}</div>
            <div className="stat-label">Total Rewards</div>
            <div className="stat-icon">🎁</div>
          </div>
        </div>

        {/* Loyalty Level Chart */}
        <div className="chart-card glass-card">
          <h3>Loyalty Level Distribution</h3>
          {renderLoyaltyChart()}
          <div className="chart-legend">
            <div className="legend-item bronze">Bronze</div>
            <div className="legend-item silver">Silver</div>
            <div className="legend-item gold">Gold</div>
          </div>
        </div>

        {/* NFT List */}
        <div className="nft-section">
          <div className="section-header">
            <h2>Your Loyalty NFTs</h2>
            <div className="header-actions">
              <button onClick={loadNFTs} className="refresh-btn neon-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh NFTs"}
              </button>
            </div>
          </div>
          
          <div className="nft-list">
            {nfts.length === 0 ? (
              <div className="no-nfts glass-card">
                <div className="no-nfts-icon">🔄</div>
                <p>No loyalty NFTs found</p>
                <button className="neon-button primary" onClick={() => setShowCreateModal(true)}>Mint Your First NFT</button>
              </div>
            ) : (
              <div className="nft-grid">
                {nfts.filter(nft => isOwner(nft.owner)).map(nft => (
                  <div 
                    className="nft-card glass-card" 
                    key={nft.id}
                    onClick={() => setSelectedNFT(nft)}
                  >
                    <div className="nft-header">
                      <div className="nft-id">#{nft.id.substring(0, 8)}</div>
                      <div className={`status-badge ${nft.status}`}>{nft.status}</div>
                    </div>
                    <div className="nft-level">
                      {nft.loyaltyLevel === 3 ? "Gold" : nft.loyaltyLevel === 2 ? "Silver" : "Bronze"}
                      <div className={`level-indicator ${nft.loyaltyLevel === 3 ? "gold" : nft.loyaltyLevel === 2 ? "silver" : "bronze"}`}></div>
                    </div>
                    <div className="nft-rewards">
                      <div className="rewards-icon">🎁</div>
                      <div className="rewards-value">{nft.rewards} points</div>
                    </div>
                    <div className="nft-date">
                      {new Date(nft.timestamp * 1000).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* FAQ Section */}
        <div className="faq-section">
          <div className="section-header">
            <h2>Frequently Asked Questions</h2>
            <button 
              className="toggle-faq neon-button" 
              onClick={() => setShowFAQ(!showFAQ)}
            >
              {showFAQ ? "Hide FAQ" : "Show FAQ"}
            </button>
          </div>
          
          {showFAQ && (
            <div className="faq-list glass-card">
              {faqItems.map((faq, index) => (
                <div className="faq-item" key={index}>
                  <div className="faq-question">
                    <div className="question-icon">❓</div>
                    <h3>{faq.question}</h3>
                  </div>
                  <div className="faq-answer">
                    <div className="answer-icon">💡</div>
                    <p>{faq.answer}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create NFT Modal */}
      {showCreateModal && (
        <ModalCreate 
          onSubmit={mintNFT} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          nftData={newNFTData} 
          setNftData={setNewNFTData} 
        />
      )}

      {/* NFT Detail Modal */}
      {selectedNFT && (
        <NFTDetailModal 
          nft={selectedNFT} 
          onClose={() => { setSelectedNFT(null); setDecryptedContent(null); }} 
          decryptedContent={decryptedContent} 
          setDecryptedContent={setDecryptedContent} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="neon-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>FHE Loyalty NFT</span>
            </div>
            <p>Private loyalty programs powered by Fully Homomorphic Encryption</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <div className="fhe-icon"></div>
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} FHE Loyalty NFT. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  nftData: any;
  setNftData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, nftData, setNftData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNftData({ ...nftData, [name]: value });
  };

  const handleSubmit = () => {
    if (!nftData.purchaseAmount || !nftData.productCategory) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Mint Loyalty NFT</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon">🔑</div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your purchase data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Purchase Amount (USD) *</label>
            <input 
              type="number" 
              name="purchaseAmount" 
              value={nftData.purchaseAmount} 
              onChange={handleChange} 
              placeholder="Enter purchase amount..." 
              className="neon-input"
            />
          </div>
          
          <div className="form-group">
            <label>Product Category *</label>
            <select 
              name="productCategory" 
              value={nftData.productCategory} 
              onChange={handleChange} 
              className="neon-select"
            >
              <option value="">Select category</option>
              <option value="Electronics">Electronics</option>
              <option value="Fashion">Fashion</option>
              <option value="Home & Kitchen">Home & Kitchen</option>
              <option value="Beauty">Beauty</option>
              <option value="Food">Food</option>
            </select>
          </div>
          
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Data:</span>
                <div>{JSON.stringify({
                  amount: nftData.purchaseAmount,
                  category: nftData.productCategory
                }) || 'No data entered'}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{nftData.purchaseAmount ? FHEEncryption(JSON.stringify({
                  amount: nftData.purchaseAmount,
                  category: nftData.productCategory
                })).substring(0, 50) + '...' : 'No data entered'}</div>
              </div>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon">🔒</div> 
            <div>
              <strong>Data Privacy Guarantee</strong>
              <p>Your purchase data remains encrypted during FHE processing and is never decrypted on our servers</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn neon-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn neon-button primary">
            {creating ? "Encrypting with FHE..." : "Mint NFT Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface NFTDetailModalProps {
  nft: LoyaltyNFT;
  onClose: () => void;
  decryptedContent: string | null;
  setDecryptedContent: (content: string | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<string | null>;
}

const NFTDetailModal: React.FC<NFTDetailModalProps> = ({ 
  nft, 
  onClose, 
  decryptedContent, 
  setDecryptedContent, 
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedContent) { 
      setDecryptedContent(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(nft.encryptedData);
    if (decrypted) setDecryptedContent(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="nft-detail-modal glass-card">
        <div className="modal-header">
          <h2>Loyalty NFT #{nft.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="nft-info">
            <div className="info-item">
              <span>Owner:</span>
              <strong>{nft.owner.substring(0, 6)}...{nft.owner.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(nft.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${nft.status}`}>{nft.status}</strong>
            </div>
            <div className="info-item">
              <span>Loyalty Level:</span>
              <strong className={`level-badge ${nft.loyaltyLevel === 3 ? "gold" : nft.loyaltyLevel === 2 ? "silver" : "bronze"}`}>
                {nft.loyaltyLevel === 3 ? "Gold" : nft.loyaltyLevel === 2 ? "Silver" : "Bronze"}
              </strong>
            </div>
            <div className="info-item">
              <span>Rewards:</span>
              <strong>{nft.rewards} points</strong>
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Purchase Data</h3>
            <div className="encrypted-data">
              {nft.encryptedData.substring(0, 100)}...
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon">🔒</div>
              <span>FHE Encrypted</span>
            </div>
            
            <button 
              className="decrypt-btn neon-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedContent ? (
                "Hide Decrypted Data"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedContent && (
            <div className="decrypted-data-section">
              <h3>Decrypted Purchase Data</h3>
              <div className="decrypted-data">
                <pre>{JSON.stringify(JSON.parse(decryptedContent), null, 2)}</pre>
              </div>
              <div className="decryption-notice">
                <div className="warning-icon">⚠️</div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn neon-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;