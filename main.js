"use strict";
import EventEmitter from "events";
import NitroliteClient, { RPCChannelStatus, RPCProtocolVersion } from "@erc7824/nitrolite";
import { ethers } from "ethers";
import WebSocket from "ws"; // Node.js
import dotenv from "dotenv";

dotenv.config();
const {
  RPCMethod,
  createAuthRequestMessage,
  createAuthVerifyMessage,
  createGetLedgerBalancesMessage,
  createGetConfigMessage,
  generateRequestId,
  getCurrentTimestamp,
  parseAnyRPCResponse,
  createEIP712AuthMessageSigner,
  createAuthVerifyMessageWithJWT,
  createGetChannelsMessage,
} = NitroliteClient;

class ClearNodeConnection extends EventEmitter {
  constructor(url, stateWallet, sessionWallet) {
    super();
    this.url = url;
    this.stateWallet = stateWallet;
    this.sessionWallet = sessionWallet;
    this.ws = null;
    this.authRequestPayload = null;
    this.jwtToken = null;
    this.sessionKey = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 2;
    this.reconnectInterval = 3000; // ms
    this.requestMap = new Map(); // Track pending requests
  }

  // Message signer function
  async messageSigner(payload) {
    try {
      const message = JSON.stringify(payload);
      const digestHex = ethers.id(message);
      const messageBytes = ethers.getBytes(digestHex);
      const { serialized: signature } =
        this.stateWallet.signingKey.sign(messageBytes);
      return signature;
    } catch (error) {
      console.error("Error signing message:", error);
      throw error;
    }
  }

  // Create a signed request
  async createSignedRequest(
    method,
    params = [],
    requestId = generateRequestId()
  ) {
    const timestamp = getCurrentTimestamp();
    const requestData = [requestId, method, params, timestamp];
    const request = { req: requestData };

    // Sign the request
    const signature = await this.messageSigner(request);
    request.sig = [signature];

    return { request, requestId };
  }

  // Connect to the ClearNode
  async connect() {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.ws.close();
      }

      this.emit("connecting");

      this.ws = new WebSocket(this.url);

      // Set connection timeout
      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          this.ws.close();
          reject(new Error("Connection timeout"));
        }
      }, 10000);

      this.ws.on("open", async () => {
        clearTimeout(connectionTimeout);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit("connected");

        // Start authentication
        try {
          console.log("Trying to authenticate...");
          if (this.jwtToken) {
            const authRequest = await createAuthVerifyMessageWithJWT(
              this.jwtToken
            );
            this.ws.send(authRequest);
          } else {
            const authRequestPayload = {
              address: this.stateWallet.address,
              session_key: this.sessionWallet.address,
              app_name: "JSR App",
              expire: (Math.floor(Date.now() / 1000) - 3600).toString(), // 10 days expiration (as string)
              scope: "console",
              application: "0x0000000000000000000000000000000000000000",
              allowances: [],
            };
            this.authRequestPayload = authRequestPayload;
            const authRequest = await createAuthRequestMessage(
              authRequestPayload,
              1,
              Date.now()
            );

            this.ws.send(authRequest);
            console.log(authRequest);
          }
          // Do not resolve here, wait for auth_success
        } catch (error) {
          this.emit("error", `Authentication request failed: ${error.message}`);
          reject(error);
        }
      });

      this.ws.on("message", async (data) => {
        try {
          const message = JSON.parse(data);
          console.log("data: ", data);
          console.log("message: ", message);
          this.emit("message", message);

          // Handle authentication flow
          if (message.res && message.res[1] === RPCMethod.AuthChallenge) {
            const parsedMessage = parseAnyRPCResponse(data);
            try {
              console.log("Trying to resolve authentication challenge...");

              const walletClient = {
                account: {
                  address: this.stateWallet.address,
                },
                signTypedData: async ({
                  domain,
                  types,
                  primaryType,
                  message: msg,
                }) => {
                  const filteredTypes = { ...types };
                  delete filteredTypes.EIP712Domain;
                  const signature = await this.stateWallet.signTypedData(
                    domain,
                    filteredTypes,
                    msg
                  );
                  return signature;
                },
              };

              const eip712MessageSigner = createEIP712AuthMessageSigner(
                walletClient,
                {
                  scope: this.authRequestPayload.scope,
                  application: this.authRequestPayload.application,
                  participant: this.authRequestPayload.session_key,
                  expire: parseInt(this.authRequestPayload.expire), // 10 days expiration (as string)
                  allowances: this.authRequestPayload.allowances,
                },
                {
                  name: this.authRequestPayload.app_name,
                }
              );

              const authVerify = await createAuthVerifyMessage(
                eip712MessageSigner,
                parsedMessage
              );
              console.log("Sending signed challenge...");
              this.ws.send(authVerify);
            } catch (error) {
              this.emit(
                "error",
                `Authentication verification failed: ${error.message}`
              );
              reject(error);
            }
          } else if (message.res && (message.res[1] === RPCMethod.AuthVerify)) {
            console.log("Auth success...");
            this.isAuthenticated = true;
            const jwtToken = parseAnyRPCResponse(data)?.params?.jwtToken;
            const session_key = parseAnyRPCResponse(data)?.params?.sessionKey;
            if(jwtToken){
              this.jwtToken = jwtToken;
              this.sessionKey = session_key;
            }
            console.log("this.jwtToken: ",this.jwtToken);
            console.log("this.sessionKey: ",this.sessionKey);
            this.emit("authenticated");
            resolve(); // Authentication successful
          } else if (message.res && message.res[1] === RPCMethod.Error) {
            console.log("Auth failure...");
            this.isAuthenticated = false;
            const error = new Error(`Authentication failed: ${message.res[2]}`);
            this.emit("error", error.message);
            reject(error);
          }

          // Handle other response types
          if (message.res && message.res[0]) {
            const requestId = message.res[0];
            const handler = this.requestMap.get(requestId);
            if (handler) {
              handler.resolve(message);
              this.requestMap.delete(requestId);
            }
          }
        } catch (error) {
          console.error("Error handling message:", error);
        }
      });

      this.ws.on("error", (error) => {
        clearTimeout(connectionTimeout);
        this.emit("error", `WebSocket error: ${error.message}`);
        reject(error);
      });

      this.ws.on("close", (code, reason) => {
        clearTimeout(connectionTimeout);
        this.isConnected = false;
        this.isAuthenticated = false;
        this.emit("disconnected", { code, reason: reason.toString() });

        // Attempt to reconnect
        this.attemptReconnect();
      });
    });
  }

  // Send a request and wait for the response
  async sendRequest(method, params = []) {
    if (!this.isConnected || !this.isAuthenticated) {
      throw new Error("Not connected or authenticated");
    }

    const { request, requestId } = await this.createSignedRequest(
      method,
      params
    );

    return new Promise((resolve, reject) => {
      // Set up response handler
      const timeout = setTimeout(() => {
        this.requestMap.delete(requestId);
        reject(new Error(`Request timeout for ${method}`));
      }, 30000);

      this.requestMap.set(requestId, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject,
        timeout,
      });

      // Send the request
      try {
        this.ws.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.requestMap.delete(requestId);
        reject(error);
      }
    });
  }

  // Helper methods for common operations
  async getChannels() {
    // Using the built-in helper function from NitroliteRPC
    const message = await createGetChannelsMessage(
      (payload) => this.messageSigner(payload),
      this.stateWallet.address
    );

    return new Promise((resolve, reject) => {
      try {
        const parsed = JSON.parse(message);
        const requestId = parsed.req[0];

        const timeout = setTimeout(() => {
          this.requestMap.delete(requestId);
          reject(new Error("Request timeout for getChannels"));
        }, 30000);

        this.requestMap.set(requestId, {
          resolve: (response) => {
            clearTimeout(timeout);
            resolve(response);
          },
          reject,
          timeout,
        });

        this.ws.send(message);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getLedgerBalances(channelId) {
    // Using the built-in helper function from NitroliteRPC
    const message = await createGetLedgerBalancesMessage(
      (payload) => this.messageSigner(payload),
      channelId
    );

    return new Promise((resolve, reject) => {
      try {
        const parsed = JSON.parse(message);
        const requestId = parsed.req[0];

        const timeout = setTimeout(() => {
          this.requestMap.delete(requestId);
          reject(new Error("Request timeout for getLedgerBalances"));
        }, 30000);

        this.requestMap.set(requestId, {
          resolve: (response) => {
            clearTimeout(timeout);
            resolve(response);
          },
          reject,
          timeout,
        });

        this.ws.send(message);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getConfig() {
    // Using the built-in helper function from NitroliteRPC
    const message = await createGetConfigMessage(
      (payload) => this.messageSigner(payload),
      this.stateWallet.address
    );

    return new Promise((resolve, reject) => {
      try {
        const parsed = JSON.parse(message);
        const requestId = parsed.req[0];

        const timeout = setTimeout(() => {
          this.requestMap.delete(requestId);
          reject(new Error("Request timeout for getConfig"));
        }, 30000);

        this.requestMap.set(requestId, {
          resolve: (response) => {
            clearTimeout(timeout);
            resolve(response);
          },
          reject,
          timeout,
        });

        this.ws.send(message);
      } catch (error) {
        reject(error);
      }
    });
  }

  // Attempt to reconnect with exponential backoff
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit("error", "Maximum reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay =
      this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);

    this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });

    setTimeout(() => {
      this.connect().catch((error) => {
        console.error(
          `Reconnection attempt ${this.reconnectAttempts} failed:`,
          error
        );
      });
    }, delay);
  }

  // Disconnect from the ClearNode
  disconnect() {
    if (this.ws) {
      // Clear all pending requests
      for (const [requestId, handler] of this.requestMap.entries()) {
        clearTimeout(handler.timeout);
        handler.reject(new Error("Connection closed"));
        this.requestMap.delete(requestId);
      }

      this.ws.close(1000, "User initiated disconnect");
      this.ws = null;
    }
  }
}

// Example usage
async function main() {
  // Initialize your state wallet (this is just a placeholder)
  //   const privateKey = '0x1234...'; // Your private key
  const stateWallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const sessionWallet = ethers.Wallet.createRandom();

  // Create a ClearNode connection
  const clearNode = new ClearNodeConnection(
    process.env.WS_RPC_URL,
    stateWallet,
    sessionWallet
  );

  // Set up event handlers
  clearNode.on("message", (message) => {
    console.log("Generic message from ClearNode...\n", message, "\n");
  });
  clearNode.on("connecting", () => {
    console.log("Connecting to ClearNode...");
  });

  clearNode.on("connected", () => {
    console.log("Connected to ClearNode");
  });

  clearNode.on("authenticated", () => {
    console.log("Authenticated with ClearNode");
  });

  clearNode.on("disconnected", ({ code, reason }) => {
    console.log(`Disconnected from ClearNode: ${code} ${reason}`);
  });

  clearNode.on("error", (error) => {
    console.error(`ClearNode error: ${error}`);
  });

  clearNode.on("reconnecting", ({ attempt, delay }) => {
    console.log(
      `Reconnecting (${attempt}/${clearNode.maxReconnectAttempts}) in ${delay}ms...`
    );
  });

  try {
    // Connect and authenticate
    await clearNode.connect();
    console.log("Successfully connected and authenticated");

    // Get channels
    const channels = await clearNode.getChannels();
    console.log("Channels:", channels.res[2][0]);

    // Process the channels
    const channelList = channels.res[2][0];
    if (channelList && channelList.length > 0) {
      for (const channel of channelList) {
        console.log(`Channel ID: ${channel.channel_id}`);
        console.log(`Status: ${channel.status}`);
        console.log(`Token: ${channel.token}`);

        // Get ledger balances for the channel
        if (channel.status === RPCChannelStatus.Open) {
          const balances = await clearNode.getLedgerBalances(
            channel.channel_id
          );
          console.log(`Balances:`, balances.res[2]);
        }
      }
    } else {
      console.log("No channels found");
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    // Disconnect when done
    clearNode.disconnect();
  }
}

// Handle process termination
process.on("SIGINT", () => {
  console.log("Shutting down...");
  // Clean up resources here
  process.exit(0);
});

// Run the example
main().catch(console.error);
