# node-bitcoin-explorer

This is mostly intended as a demo application for
[bitcoinjs-server](https://github.com/bitcoinjs/bitcoinjs-server). It
replicates most of the functionality of the popular [Block
Explorer](http://blockexplorer.com/) website.

# Installation

Before you install `node-bitcoin-explorer`, make sure you have
[bitcoinjs-server](https://github.com/bitcoinjs/bitcoinjs-server)
installed.

``` sh
# Get node-bitcoin-explorer
git clone git://github.com/justmoon/node-bitcoin-explorer.git --recursive

# Go to folder
cd node-bitcoin-explorer

# Link to global bitcoinjs installation
npm link bitcoinjs

# Install dependencies
npm install
```

# Usage

To start the server

    node app.js

The application will be visible on http://localhost:3000/
