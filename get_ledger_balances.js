import NitroliteClient from '@erc7824/nitrolite';
import { ethers } from 'ethers';

const { createGetLedgerBalancesMessage, parseRPCMessage, RPCMethod } = NitroliteClient;

// Your message signer function (same as in auth flow)
const messageSigner = async (payload) => {
  const message = JSON.stringify(payload);
  const digestHex = ethers.id(message);
  const messageBytes = ethers.getBytes(digestHex);
  const { serialized: signature } = stateWallet.signingKey.sign(messageBytes);
  return signature;
};

// Function to get ledger balances
async function getLedgerBalances(ws, participant) {
  return new Promise((resolve, reject) => {
    // Create a unique handler for this specific request
    const handleMessage = (event) => {
      const message = parseRPCMessage(event.data);
      
      // Check if this is a response to our get_ledger_balances request
      if (message.method === RPCMethod.GetLedgerBalances) {
        // Remove the message handler to avoid memory leaks
        ws.removeEventListener('message', handleMessage);
        
        // Resolve with the balances data
        resolve(message.params);
      }
    };
    
    // Add the message handler
    ws.addEventListener('message', handleMessage);
    
    // Create and send the ledger balances request
    createGetLedgerBalancesMessage(messageSigner, participant)
      .then(message => {
        ws.send(message);
      })
      .catch(error => {
        // Remove the message handler on error
        ws.removeEventListener('message', handleMessage);
        reject(error);
      });
      
    // Set a timeout to prevent hanging indefinitely
    setTimeout(() => {
      ws.removeEventListener('message', handleMessage);
      reject(new Error('Timeout waiting for ledger balances'));
    }, 10000); // 10 second timeout
  });
}

// Simple balance monitoring function
function startBalanceMonitoring(ws, participantAddress, messageSigner, intervalMs = 10000) {
  // Check immediately on start
  getLedgerBalances(ws, participantAddress, messageSigner)
    .then(displayBalances)
    .catch(err => console.error('Initial balance check failed:', err));
  
  // Set up interval for regular checks
  const intervalId = setInterval(() => {
    getLedgerBalances(ws, participantAddress, messageSigner)
      .then(displayBalances)
      .catch(err => console.error('Balance check failed:', err));
  }, intervalMs); // Check every 30 seconds by default
  
  // Return function to stop monitoring
  setTimeout(() => {
      return () => clearInterval(intervalId);
  }, 30000);
}

// Simple display function
function displayBalances(balances) {
  console.log(`Balance update at ${new Date().toLocaleTimeString()}:`);
  
  // Format and display your balances
  if (balances.length > 0) {
    console.log('My balances:');
    balances.forEach(balance => {
      console.log(`- ${balance.asset.toUpperCase()}: ${balance.amount}`);
    });
  } else {
    console.log('No balance data available');
  }
}


// Usage example
const participantAddress = '0x1234567890abcdef1234567890abcdef12345678';

try {
  const balances = await getLedgerBalances(ws, participantAddress);
  
//   console.log('Channel ledger balances:', balances);
//   // Example output:
//   // [
//   //   [
//   //     { "asset": "usdc", "amount": "100.0" },
//   //     { "asset": "eth", "amount": "0.5" }
//   //   ]
//   // ]
  
//   // Process your balances
//   if (balances.length > 0) {
//     // Display each asset balance
//     balances.forEach(balance => {
//       console.log(`${balance.asset.toUpperCase()} balance: ${balance.amount}`);
//     });
    
//     // Example: find a specific asset
//     const usdcBalance = balances.find(b => b.asset.toLowerCase() === 'usdc');
//     if (usdcBalance) {
//       console.log(`USDC balance: ${usdcBalance.amount}`);
//     }
//   } else {
//     console.log('No balance data available');
//   }

  // Regular Polling
  startBalanceMonitoring(ws,participantAddress,messageSigner);


} catch (error) {
  console.error('Failed to get ledger balances:', error);
}