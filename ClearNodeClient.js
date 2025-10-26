import EventEmitter from "events";
import NitroliteClient, { getTimestamp } from "@erc7824/nitrolite";
import { ethers } from "ethers";
import WebSocket from "ws";

const {
  RPCMethod,
  createAuthRequestMessage,
  createAuthVerifyMessage,
  createGetLedgerBalancesMessage,
  createGetConfigMessage,
  createGetChannelsMessage,
  generateRequestId,
  getCurrentTimestamp,
  parseAnyRPCResponse,
  createEIP712AuthMessageSigner,
  createAuthVerifyMessageWithJWT,
} = NitroliteClient;

/**
 * Configuration for ClearNode connection
 */
export const DEFAULT_CONFIG = {
  reconnect: {
    maxAttempts: 2,
    interval: 3000,
  },
  timeout: {
    connection: 10000,
    request: 30000,
  },
  auth: {
    appName: "JSR App",
    scope: "console",
    application: "0x0000000000000000000000000000000000000000",
    expireDays: 10,
  },
};

/**
 * Manages WebSocket connection to ClearNode
 */
export default class ClearNodeConnection extends EventEmitter {
  constructor(url, stateWallet, sessionWallet, config = {}) {
    super();

    this.url = url;
    this.stateWallet = stateWallet;
    this.sessionWallet = sessionWallet;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Connection state
    this.ws = null;
    this.isConnected = false;
    this.isAuthenticated = false;

    // Auth state
    this.authRequestPayload = null;
    this.jwtToken = null;
    this.sessionKey = null;

    // Reconnection state
    this.reconnectAttempts = 0;

    // Request tracking
    this.requestMap = new Map();
  }

  // getter methods
  getAddress() {
    return this.stateWallet.address;
  }
  getSessionKey() {
    return this.sessionKey;
  }
  getJWT() {
    return this.jwtToken;
  }
  // isAuthenticated() {
  //   return this.isAuthenticated;
  // }
  // isConnected() {
  //   return this.isConnected;
  // }

  /**
   * Connect to ClearNode and authenticate
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this._closeExistingConnection();
      this.emit("connecting");

      this.ws = new WebSocket(this.url);
      const connectionTimeout = this._setupConnectionTimeout(reject);

      this._setupWebSocketHandlers(connectionTimeout, resolve, reject);
    });
  }

  /**
   * Send a request and wait for response
   */
  async sendRequest(method, params = []) {
    this._ensureConnected();

    const { request, requestId } = await this._createSignedRequest(
      method,
      params
    );

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestMap.delete(requestId);
        reject(new Error(`Request timeout for ${method}`));
      }, this.config.timeout.request);

      this.requestMap.set(requestId, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject,
        timeout,
      });

      try {
        this.ws.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.requestMap.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * Get all channels for the current wallet
   */
  async getChannels() {
    const message = await createGetChannelsMessage(
      (payload) => this._signMessage(payload),
      this.sessionWallet.address
    );
    await this._sendPrebuiltMessage(message, "getChannels");
  }

  /**
   * Get ledger balances for a specific channel
   */
  async getLedgerBalances(channelId) {
    const message = await createGetLedgerBalancesMessage(
      (payload) => this._signMessage(payload),
      channelId
    );
    return this._sendPrebuiltMessage(message, "getLedgerBalances");
  }

  /**
   * Get configuration from ClearNode
   */
  async getConfig() {
    const message = await createGetConfigMessage(
      (payload) => this._signMessage(payload),
      1,
      getTimestamp(),
      // this.stateWallet.address
    );
    return this._sendPrebuiltMessage(message, "getConfig");
  }

  /**
   * Disconnect from ClearNode
   */
  disconnect() {
    if (!this.ws) return;

    this._clearPendingRequests();
    this.ws.close(1000, "User initiated disconnect");
    this.ws = null;
  }

  // Private methods

  _closeExistingConnection() {
    if (this.ws) {
      this.ws.close();
    }
  }

  _setupConnectionTimeout(reject) {
    return setTimeout(() => {
      if (!this.isConnected) {
        this.ws.close();
        reject(new Error("Connection timeout"));
      }
    }, this.config.timeout.connection);
  }

  _setupWebSocketHandlers(connectionTimeout, resolve, reject) {
    this.ws.on("open", () => this._handleOpen(connectionTimeout));
    this.ws.on("message", (data) => this._handleMessage(data, resolve, reject));
    this.ws.on("error", (error) =>
      this._handleError(error, connectionTimeout, reject)
    );
    this.ws.on("close", (code, reason) =>
      this._handleClose(code, reason, connectionTimeout)
    );
  }

  async _handleOpen(connectionTimeout) {
    clearTimeout(connectionTimeout);
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.emit("connected");

    try {
      await this._initiateAuthentication();
    } catch (error) {
      this.emit("error", `Authentication request failed: ${error.message}`);
    }
  }

  async _initiateAuthentication() {
    console.log("Trying to authenticate...");

    if (this.jwtToken) {
      const authRequest = await createAuthVerifyMessageWithJWT(this.jwtToken);
      this.ws.send(authRequest);
    } else {
      this.authRequestPayload = {
        address: this.stateWallet.address,
        session_key: this.sessionWallet.address,
        app_name: this.config.auth.appName,
        expire: this._calculateExpiration(),
        scope: this.config.auth.scope,
        application: this.config.auth.application,
        allowances: [],
      };
      const authRequest = await createAuthRequestMessage(
        this.authRequestPayload,
        1,
        Date.now()
      );
      this.ws.send(authRequest);
      console.log(authRequest);
    }
  }

  _calculateExpiration() {
    const expireDays = this.config.auth.expireDays;
    return (
      Math.floor(Date.now() / 1000) +
      expireDays * 24 * 60 * 60
    ).toString();
  }

  async _handleMessage(data, resolve, reject) {
    try {
      const message = JSON.parse(data);
      console.log("message:", message);
      if(message.res[1]==='assets'){
        // console.log("message.res[2]:", message.res[2]);
        // do nothing
        resolve();
        return;
      }
      const parsedResponse = parseAnyRPCResponse(data);
      // console.log("data:", data);
      console.log("parsedResponse:", {...parsedResponse});
      // console.log("parsedResponse.params:", parsedResponse.params);
      this.emit("message", parsedResponse);

      if (parsedResponse.params && parsedResponse.method === RPCMethod.AuthChallenge) {
        await this._handleAuthChallenge(parsedResponse, reject);
      } else if (parsedResponse.params && parsedResponse.method === RPCMethod.AuthVerify) {
        this._handleAuthSuccess(parsedResponse, resolve);
      } else if (parsedResponse.params && parsedResponse.method === RPCMethod.Error) {
        this._handleRPCError(parsedResponse, reject);
      }

      this._handlePendingRequest(parsedResponse);
    } catch (error) {
      console.error("Error handling message:", error);
    }
  }

  async _handleAuthChallenge(parsedMessage, reject) {
    try {
      console.log("Trying to resolve authentication challenge...");

      const walletClient = this._createWalletClient();
      const eip712MessageSigner = createEIP712AuthMessageSigner(
        walletClient,
        {
          scope: this.authRequestPayload.scope,
          application: this.authRequestPayload.application,
          participant: this.authRequestPayload.session_key,
          expire: parseInt(this.authRequestPayload.expire),
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
  }

  _createWalletClient() {
    return {
      account: {
        address: this.stateWallet.address,
      },
      signTypedData: async ({ domain, types, primaryType, message: msg }) => {
        const filteredTypes = { ...types };
        delete filteredTypes.EIP712Domain;
        return this.stateWallet.signTypedData(domain, filteredTypes, msg);
      },
    };
  }

  _handleAuthSuccess(parsedResponse, resolve) {
    console.log("Auth success...");
    this.isAuthenticated = true;

    const jwtToken = parsedResponse?.params?.jwtToken;
    const sessionKey = parsedResponse?.params?.sessionKey;

    if (jwtToken) {
      this.jwtToken = jwtToken;
      this.sessionKey = sessionKey;
    }

    console.log("this.jwtToken:", this.jwtToken);
    console.log("this.sessionKey:", this.sessionKey);
    this.emit("authenticated");
    resolve();
  }

  _handleRPCError(parsedResponse, reject) {
    console.log("RPC Error...");
    this.isAuthenticated = false;
    const error = new Error(`RPC Error: ${parsedResponse.params.error}`);
    this.emit("error", error.message);
    reject(error);
  }

  _handlePendingRequest(parsedResponse) {
    if (parsedResponse.params) {
      const requestId = parsedResponse.requestId;
      const handler = this.requestMap.get(requestId);
      if (handler) {
        handler.resolve(parsedResponse);
        this.requestMap.delete(requestId);
      }
    }
  }

  _handleError(error, connectionTimeout, reject) {
    clearTimeout(connectionTimeout);
    this.emit("error", `WebSocket error: ${error.message}`);
    reject(error);
  }

  _handleClose(code, reason, connectionTimeout) {
    clearTimeout(connectionTimeout);
    this.isConnected = false;
    this.isAuthenticated = false;
    this.emit("disconnected", { code, reason: reason.toString() });
    this._attemptReconnect();
  }

  async _signMessage(payload) {
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

  async _createSignedRequest(
    method,
    params = [],
    requestId = generateRequestId()
  ) {
    const timestamp = getCurrentTimestamp();
    const requestData = [requestId, method, params, timestamp];
    const request = { req: requestData };

    const signature = await this._signMessage(request);
    request.sig = [signature];

    return { request, requestId };
  }

  async _sendPrebuiltMessage(message, methodName) {
    return new Promise((resolve, reject) => {
      try {
        const parsed = JSON.parse(message);
        const requestId = parsed.req[0];

        const timeout = setTimeout(() => {
          this.requestMap.delete(requestId);
          reject(new Error(`Request timeout for ${methodName}`));
        }, this.config.timeout.request);

        this.requestMap.set(requestId, {
          resolve: (response) => {
            // const parsedResponse = parseAnyRPCResponse(response);
            clearTimeout(timeout);
            resolve(response);
          },
          reject,
          timeout,
        });

        console.log("Sending message to clearnode...",message);
        this.ws.send(message);
      } catch (error) {
        reject(error);
      }
    });
  }

  _attemptReconnect() {
    if (this.reconnectAttempts >= this.config.reconnect.maxAttempts) {
      this.emit("error", "Maximum reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay =
      this.config.reconnect.interval * Math.pow(2, this.reconnectAttempts - 1);

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

  _clearPendingRequests() {
    for (const [requestId, handler] of this.requestMap.entries()) {
      clearTimeout(handler.timeout);
      handler.reject(new Error("Connection closed"));
      this.requestMap.delete(requestId);
    }
  }

  _ensureConnected() {
    if (!this.isConnected || !this.isAuthenticated) {
      throw new Error("Not connected or authenticated");
    }
  }
}
