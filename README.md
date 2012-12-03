Bitcoin-tx-spent-db
===============

Based on: https://github.com/bitcoinjs/node-bitcoin-explorer

This is a reverse of the bitcoin tx graph you can query which txs spends a certain output

Installation in Ubuntu:

after fresh install

    sudo apt-get update

Dependencies

    sudo apt-get install build-essential python2.7 pkg-config libssl-dev git

Node v0.8.8

    git clone git://github.com/joyent/node.git
    cd node
    git checkout v0.8.8
    ./configure
    make
    sudo make install

Install bitcoinJS:

    sudo npm install -g bitcoinjs --unsafe-perm

    mkdir /home/ubuntu/.bitcoinjs
    cp /usr/local/lib/node_modules/bitcoinjs/daemon/settings.example.js /home/ubuntu/.bitcoinjs/settings.js

Install Bitcoin-tx-spent-db:

    cd ~

    git clone git://github.com/0i0/bitcoin-tx-spent-db.git

    cd Bitcoin-tx-spent-db/
    sudo npm link bitcoinjs
    sudo npm install

    cp ~/bitcoinjs-color/node_modules/bitcoinjs/daemon/settings.example.js ~/bitcoinjs-color/node_modules/bitcoinjs/daemon/settings.js

Edit ~/bitcoinjs-color/node_modules/bitcoinjs/daemon/settings.js
Change the following:

    cfg.jsonrpc.enable = true;
    cfg.jsonrpc.password = "admin";

This is for Amazon AWS to work on port 80

    sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports 3333

Creating the DB

    bitcoinjs start
    node app.js create
    
Droping the DB

    node app.js create
    
Running the query server

    node app.js
