var bitcoin = require('../bitcoin');
var Util = require('../util');
var Step = require('step');
var Bignum = bitcoin.bignum;

function getOutpoints(blockChain, txStore, txs, callback) {
  if (!Array.isArray(txs)) {
    txs = [txs];
  }

  Step(
    function fetchTxInputsStep() {
      var group = this.group();
      txs.forEach(function (tx) {
        if (tx.isCoinBase()) return;

        var callback = group();
        tx.cacheInputs(blockChain, txStore, false, function (err, cache) {
          if (err) {
            callback(err);
            return;
          }

          tx.ins.forEach(function (txin) {
            var prevTx = cache.txIndex[txin.getOutpointHash().toString('base64')];

            txin.source = prevTx[txin.getOutpointIndex()];
          });
          callback();
        });
      });
    },
    function calculateStep(err) {
      if (err) throw err;

      txs.forEach(function (tx, i) {
        tx.totalIn = Bignum(0);
        tx.totalOut = Bignum(0);
        tx.ins.forEach(function (txin, j) {
          if (txin.isCoinBase()) return;

          tx.totalIn = tx.totalIn.add(Util.valueToBigInt(txin.source.v));
        });
        // TODO: Add block value to totalIn for coinbase
        tx.outs.forEach(function (txout, j) {
          tx.totalOut = tx.totalOut.add(Util.valueToBigInt(txout.v));
        });

        if (!tx.isCoinBase()) tx.fee = tx.totalIn.sub(tx.totalOut);
      });
      this(null, txs);
    },
    callback
  );
};

function formatTx(tx) {
  var data = tx.getStandardizedObject();

  tx.ins.forEach(function (txin, j) {
    if (txin.isCoinBase()) {
      data.in[j].type = 'coinbase';
      return;
    }
    if (txin.source) {
      data.in[j].sourceAddr = Util.pubKeyHashToAddress(txin.source.getScript().simpleOutPubKeyHash());
      data.in[j].value = Util.formatValue(txin.source.v);
    }
    data.in[j].type = txin.getScript().getInType();
  });

  tx.outs.forEach(function (txout, j) {
    data.out[j].toAddr = Util.pubKeyHashToAddress(txout.getScript().simpleOutPubKeyHash());
    data.out[j].type = txout.getScript().getOutType();
  });

  data.totalIn = Util.formatValue(tx.totalIn);
  data.totalOut = Util.formatValue(tx.totalOut);
  if (tx.fee) data.fee = Util.formatValue(tx.fee);

  data.size = tx.serialize().length;

  return data;
};

exports.indexquery = function (args, opt, callback) {
  var self = this;

  var Bignum = bitcoin.bignum;

  var storage = this.node.getStorage();

  var result = {};

  var count = +args[0];
  Step(
    function getLatestBlocksHashesStep() {
      self.node.getStorage().getBlockSlice(-count, 0, this);
    },
    function getLatestBlocksDataStep(err, results) {
      if (err) throw err;

      var group = this.group();
      results.reverse();
      results.forEach(function (hash) {
        storage.getBlockByHash(hash, group());
      });
    },
    function getLatestBlocksTransactionsStep(err, results) {
      if (err) throw err;

      var group = this.group();
      results.forEach(function (block) {
        var callback = group();
        storage.getTransactionsByHashes(block.txs, function (err, txs) {
          block.txs = txs;
          callback(null, block);
        });
      });
    },
    function composeResult(err, results) {
      if (err) throw err;

      result.latestBlocks = results.map(function (block) {
        var data = {};
        data.hash = Util.formatHashFull(block.getHash());
        data.height = block.height;
        data.time = block.timestamp;
        data.txCount = block.txs.length;
        var value = Bignum(0);
        block.txs.forEach(function (tx) {
          tx.outs.forEach(function (out) {
            value = value.add(Util.valueToBigInt(out.v));
          });
        });
        data.totalOut = Util.formatValue(value);
        data.size = block.size;
        return data;
      });

      this(null, result);
    },
    callback
  );
};

exports.txquery = function (args, opt, callback) {
  var hash64 = args[0];
  var hash = new Buffer(hash64, 'base64');

  var storage = this.node.getStorage();
  var blockChain = this.node.getBlockChain();
  var txStore = this.node.getTxStore();

  var result = {};

  Step(
    function getMemTxStep() {
      txStore.get(hash, this);
    },
    function getChainTxStep(err, tx) {
      if (tx) {
        // We already found the transaction, just store it
        result.tx = tx;
        // And then skip to fetchOutpointsStep
        throw 'fetchop';
      } else {
        // The transaction isn't in the memory pool, check the database
        storage.getTransactionByHash(hash, this);
      }
    },
    function getBlockHashStep(err, tx) {
      if (err) throw err;

      if (tx) {
        // We found the transaction, store it
        result.tx = tx;
      } else {
        // We still couldn't find the transaction, return undefined
        callback(null, undefined);
        return;
      }

      // Get the containing block
      storage.getContainingBlock(hash, this);
    },
    function getBlockStep(err, blockHash) {
      if (err) throw err;

      if (!blockHash) {
        // TODO: Strange orphan (corrupt db)
        callback(null, new Error('Block containing transaction not indexed, '
                                 + 'db corrupt.'));
        return;
      }

      // Get the containing block
      storage.getBlockByHash(blockHash, this);
    },
    function storeBlockStep(err, block) {
      if (err) throw err;

      if (!block) {
        // TODO: Strange orphan (corrupt db)
        callback(null, new Error('Block containing transaction not found, '
                                 + 'db corrupt.'));
        return;
      }
      result.block = block.getStandardizedObject();
      this(null);
    },
    function fetchOutpointsStep(err) {
      if (err && err !== 'fetchop') throw err;
      getOutpoints(blockChain, txStore, result.tx, this);
    },
    function returnResultStep(err) {
      if (err) throw err;

      result.tx = formatTx(result.tx);

      this(null, result);
    },
    callback
  );
};

exports.blockquery = function (args, opt, callback) {
  var hash64 = args[0];
  var hash = new Buffer(hash64, 'base64');

  var storage = this.node.getStorage();
  var blockChain = this.node.getBlockChain();
  var txStore = this.node.getTxStore();

  var result = {};

  var Bignum = bitcoin.bignum;

  Step(
    function getBlockStep() {
      storage.getBlockByHash(hash, this);
    },
    function getNextBlockStep(err, block) {
      if (err) throw err;

      result.block = block;

      storage.getBlockByPrev(hash, this);
    },
    function getTransactions(err, nextBlock) {
      if (err) throw err;

      result.nextBlock = nextBlock;

      storage.getTransactionsByHashes(result.block.txs, this);
    },
    function getOutpointsStep(err, txs) {
      if (err) throw err;

      result.txs = txs;

      getOutpoints(blockChain, txStore, txs, this);
    },
    function formatResultStep(err) {
      if (err) throw err;

      var totalFee = Bignum(0);
      var totalOut = Bignum(0);
      result.txs.forEach(function (tx) {
        tx.outs.forEach(function (txout) {
          totalOut = totalOut.add(Util.valueToBigInt(txout.v));
        });
        if (tx.fee) totalFee = totalFee.add(tx.fee);
      });

      var blockValue = Util.valueToBigInt(result.txs[0].outs[0].v).sub(totalFee);

      var formattedResult = {};
      formattedResult.block = result.block.getStandardizedObject();
      if (result.nextBlock) {
        formattedResult.nextBlock = result.nextBlock.getStandardizedObject();
      }
      formattedResult.txs = result.txs.map(formatTx);
      formattedResult.totalFee = Util.formatValue(totalFee);
      formattedResult.totalOut = Util.formatValue(totalOut);
      formattedResult.blockValue = Util.formatValue(blockValue);

      this(null, formattedResult);
    },
    callback
  );
};

exports.addrquery = function addrquery(args, opt, callback) {
  var addr64 = args[0];
  var addr = new Buffer(addr64, 'base64');

  var storage = this.node.getStorage();
  var blockChain = this.node.getBlockChain();
  var txStore = this.node.getTxStore();

  var result = {};

  function getContainingBlockHashes(txs, callback) {
    Step(
      function getBlockHashStep() {
        var parallel = this.parallel;
        txs.forEach(function (tx) {
          var cb = parallel();
          storage.getContainingBlock(tx.getHash(), function (err, blockHash) {
            if (err) {
              cb(err);
              return;
            }

            tx.blockHash = blockHash;


            storage.getBlockByHash(blockHash, function (err, block) {
              if (err) {
                cb(err);
                return;
              }

              tx.blockHeight = block.height;
              tx.blockTime = block.timestamp;

              cb();
            });
          });
        });
      },
      function replaceReturnValueStep() {
        this(null, txs);
      },
      callback
    );
  };

  // TODO: We have to limit no of transactions. Need to implement paging and fix
  //       "spent in" for this case.
  Step(
    function getTxListStep() {
      storage.getAffectedTransactions(addr, this);
    },
    function getTxsStep(err, txList) {
      if (err) throw err;

      storage.getTransactionsByHashes(txList, this);
    },
    function getOutpointsStep(err, txs) {
      if (err) throw err;

      getOutpoints(blockChain, txStore, txs, this);
    },
    function getContainingBlocksStep(err, txs) {
      if (err) throw err;

      getContainingBlockHashes(txs, this);
    },
    function processResultsStep(err, txs) {
      if (err) throw err;

      var receivedCount = 0;
      var receivedAmount = Bignum(0);
      var sentCount = 0;
      var sentAmount = Bignum(0);

      var txOutsObj = {};
      txs.forEach(function (tx, index) {
        for (var i = 0; i < tx.outs.length; i++) {
          var txout = tx.outs[i];
          var script = txout.getScript();

          var outPubKey = script.simpleOutPubKeyHash();

          if (outPubKey && addr.equals(outPubKey)) {
            receivedCount++;
            var outIndex =
              tx.getHash().toString('base64')+":"+
              i;
            txOutsObj[outIndex] = txout;

            receivedAmount = receivedAmount.add(Util.valueToBigInt(txout.v));

            tx.myOut = i;
          }
        };
      });

      txs.forEach(function (tx, index) {
        if (tx.isCoinBase()) return;

        tx.ins.forEach(function (txin, j) {
          var script = txin.source.getScript();

          var outPubKey = script.simpleOutPubKeyHash();

          if (outPubKey && addr.equals(outPubKey)) {
            sentCount++;
            var outIndex =
              txin.getOutpointHash().toString('base64')+":"+
              txin.getOutpointIndex();

            if (!txOutsObj[outIndex]) {
              // TODO: Log following message:
              // Outgoing transaction is missing matching incoming transaction.
              return;
            }
            txOutsObj[outIndex].spent = {
              txin: txin,
              tx: tx
            };

            sentAmount = sentAmount.add(Util.valueToBigInt(txin.source.v));

            tx.myIn = j;
          }
        });
      });

      txs = txs.map(function (tx) {
        var txData = {};

        txData.hash = Util.formatHashFull(tx.getHash());
        txData.blockHash = Util.formatHashFull(tx.blockHash);
        txData.blockHeight = tx.blockHeight;
        txData.blockTime = tx.blockTime;

        if ("undefined" !== typeof tx.myIn) {
          var txin = tx.ins[tx.myIn];
          txData.value = Util.formatValue(txin.source.v);
          txData.type = txin.getScript().getInType();

          if (txin.isCoinBase()) {
            txData.coinbase = true;
          } else {
            var pubKeyHash = txin.source.getScript().simpleOutPubKeyHash();
            txData.sourceAddr = Util.pubKeyHashToAddress(pubKeyHash);
          }

          txData.out = tx.outs.map(function (txout) {
            var pubKeyHash = txout.getScript().simpleOutPubKeyHash();
            return {
              toAddr: Util.pubKeyHashToAddress(pubKeyHash)
            };
          });
        } else if ("undefined" !== typeof tx.myOut) {
          var txout = tx.outs[tx.myOut];
          txData.isOut = true;

          if (txout.spent) {
            txData.spentHash = Util.formatHashFull(txout.spent.tx.getHash());
          }
          txData.value = Util.formatValue(txout.v);
          txData.type = txout.getScript().getOutType();

          txData.in = tx.ins.map(function (txin) {
            if (txin.isCoinBase()) {
              return { coinbase: true };
            } else {
              var pubKeyHash = txin.source.getScript().simpleOutPubKeyHash();
              return {
                sourceAddr: Util.pubKeyHashToAddress(pubKeyHash)
              };
            }
          });
        }

        return txData;
      });

      // Calculate the current available balance
      var totalAvailable = receivedAmount.sub(sentAmount);

      var account = {};
      account.firstSeenHash = ""; // TODO
      account.firstSeenHeight = ""; // TODO
      account.firstSeenTime = ""; // TODO
      account.pubKeyHashHex = addr.toString('hex');
      account.totalAvailable = Util.formatValue(totalAvailable);
      account.receivedCount = receivedCount;
      account.receivedAmount = Util.formatValue(receivedAmount);
      account.sentCount = sentCount;
      account.sentAmount = Util.formatValue(sentAmount);

      result.account = account;
      result.txs = txs;

      this(null, result);
    },
    callback
  );
};
