
import NitroliteClient from "@erc7824/nitrolite";
import { ethers, Wallet } from "ethers";
import WebSocket from 'ws'; // Node.js
import dotenv from  'dotenv';

dotenv.config();

// Create a WebSocket connection to the ClearNode
const ws = new WebSocket(process.env.WS_RPC_URL);
console.log(process.env.PRIVATE_KEY);

const wallet = new Wallet(process.env.PRIVATE_KEY);
console.log(wallet);
// wss://clearnet-sandbox.yellow.com/ws

// // Set up basic event handlers
// ws.onopen = () => {
//   console.log('WebSocket connection established');
//   // Connection is open, can now proceed with authentication
// };

// ws.onmessage = (event) => {
//   const message = JSON.parse(event.data);
//   console.log('Received message:', message);
//   // Process incoming messages
// };

// ws.onerror = (error) => {
//   console.error('WebSocket error:', error);
// };

// ws.onclose = (event) => {
//   console.log(`WebSocket closed: ${event.code} ${event.reason}`);
// };



const {
  createAuthRequestMessage,
  createAuthVerifyMessage,
  createEIP712AuthMessageSigner,
  parseAnyRPCResponse,
  RPCMethod,
} = NitroliteClient;
// Create and send auth_request
const authRequestMsg = await createAuthRequestMessage({
  address: wallet.address,
  //   session_key: '0xYourSignerAddress',
  app_name: "JSR App",
  expire: (Math.floor(Date.now() / 1000) + 10 * 24 * 3600).toString(), // 10 days expiration (as string)
  //   scope: 'console',
  //   application: '0xYourApplicationAddress',
    allowances: [],
});

console.log("authRequestMsg: \n", authRequestMsg);
// After WebSocket connection is established
ws.onopen = async () => {
  console.log("WebSocket connection established");

  ws.send(authRequestMsg);
};
// Handle incoming messages
ws.onmessage = async (event) => {
  try {
    const message = parseAnyRPCResponse(event.data);

    // Handle auth_challenge response
    switch (message.method) {
      case RPCMethod.AuthChallenge:
        console.log("Received auth challenge");
        console.log("RPCMethod.AuthChallenge message: \n", message);

        // Create a wallet client adapter for ethers
        const walletClientAdapter = {
          account: {
            address: wallet.address,
          },
          signTypedData: async ({ domain, types, primaryType, message }) => {
            // Use ethers v6 signTypedData
            return await wallet.signTypedData(domain, types, message);
          },
        };

        // Create EIP-712 message signer function
        const eip712MessageSigner = createEIP712AuthMessageSigner(
          walletClientAdapter, // Your wallet client instance
          {
            // EIP-712 message structure, data should match auth_request
            // scope: authRequestMsg.scope,
            // application: authRequestMsg.application,
            // participant: authRequestMsg.participant,
            expire: authRequestMsg.expire,
            // allowances: authRequestMsg.allowances,
          },
          {
            // Domain for EIP-712 signing
            name: "idk",
          }
        );

        // Create and send auth_verify with signed challenge
        const authVerifyMsg = await createAuthVerifyMessage(
          eip712MessageSigner, // Our custom eip712 signer function
          message
        );

        console.log("authVerifyMsg: \n", authVerifyMsg);

        ws.send(authVerifyMsg);
        break;
      // Handle auth_success or auth_failure
      case RPCMethod.AuthVerify:
        if (!message.params.success) {
          console.log("Authentication failed");
          return;
        }
        console.log("Authentication successful");
        console.log("message: \n", message);
        // Now you can start using the channel
        // console.log("clearnode_jwt", message.params.jwtToken);

        // window.localStorage.setItem("clearnode_jwt", message.params.jwtToken); // Store JWT token for future use
        break;
      case RPCMethod.Error: {
        console.error("Authentication failed:", message.params.error);
      }
    }
  } catch (error) {
    console.error("Error handling message:", error);
  }
};
