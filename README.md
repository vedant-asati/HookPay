# HookPay

A CLI for trustless, pay-per-use API billing, built on the Yellow Network.

-----

## Problem

Monetizing APIs with granular, pay-per-use billing is difficult.

1.  **Micropayment Infeasibility:** Traditional payment processors (like Stripe) have high fixed fees (e.g., $0.30/txn), making it impossible to charge $0.001 for a single API call.
2.  **Forced Workarounds:** This forces providers to use inefficient models like monthly subscriptions or pre-paid credit systems.
3.  **Capital Lock-in:** Pre-paid credits lock up user funds in a provider's database, creating a poor user experience and preventing that capital from being used elsewhere.

## Solution

HookPay uses the Yellow Network's state channels to enable true, "pay-as-you-go" micropayments.

1.  **Off-Chain Payments:** A user (developer) deposits funds (e.g., 10 USDC) into a Yellow smart contract *once*. They can then make thousands of API calls, with each call sending a gasless, instant, off-chain micropayment to the API provider.
2.  **On-Chain Settlement:** When the user is finished, they settle the channel. This is the *only* other on-chain transaction. The provider receives their accumulated earnings, and the user gets their remaining balance back.
3.  **Trustless:** The user's funds are held in a trustless smart contract, not by the API provider.

## Architecture

The project consists of two main components:

1.  **`hookpay-cli` (Consumer):** A Node.js CLI for the developer. It manages their wallet, deposits funds, and wraps their API calls with the required off-chain payment signatures.
2.  **`hookpay-proxy` (Provider):** A lightweight Express.js server that the API provider runs. It sits in front of their existing API, validates incoming off-chain payments, and then forwards the request to their backend.

## Tech Stack

  * **HookPay CLI:** Node.js, [WIP]
  * **HookPay Proxy:** Node.js, [WIP]
  * **Payment Layer:** Yellow Network SDK (Nitrolite Protocol)
  * **Blockchain:** EVM-compatible chain (for on-chain deposit and settlement)

## How It Works (User Flow)

1.  **`hookpay login`**: The developer authenticates their wallet.
2.  **`hookpay deposit`**: The developer makes an on-chain transaction to deposit USDC into the Yellow state channel.
3.  **`hookpay call <api-name>`**: The CLI sends the API request *plus* a signed off-chain payment to the provider's proxy. This is instant and gasless. The user can do this thousands of times.
4.  **`hookpay settle`**: The developer makes a final on-chain transaction to close the channel, pay the provider, and withdraw their remaining funds.

## Local Development & Demo

This project includes a simulation script to demonstrate the full user flow in a clean, reliable way.

1.  Install dependencies:
    ```bash
    npm install
    # or
    pnpm install
    ```
2.  Run the demo script:
    ```bash
    node demo.js

## Contributions

This project is currently a work in progress (WIP).

We are open to contributions! Feel free to open an issue or submit a pull request.