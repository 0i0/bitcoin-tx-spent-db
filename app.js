/**
 * Module dependencies.
 */
var express = require('express');
var winston = require('winston');
var toposort = require('toposort')
var Step = require('step');
var bitcoin = require('bitcoinjs');
var RpcClient = require('jsonrpc2').Client;
var bigint = global.bigint = bitcoin.bigint;
var Db = require('mongodb').Db
  , Connection = require('mongodb').Connection
  , Server = require('mongodb').Server;

var host = process.env['MONGO_NODE_DRIVER_HOST'] != null ? process.env['MONGO_NODE_DRIVER_HOST'] : 'localhost';
var port = process.env['MONGO_NODE_DRIVER_PORT'] != null ? process.env['MONGO_NODE_DRIVER_PORT'] : Connection.DEFAULT_PORT;

console.log("Connecting to " + host + ":" + port);
var db = new Db('test', new Server(host, port, {}), {native_parser:true});

global.Util = require('./util');
var fs = require('fs');

var init = require('bitcoinjs/daemon/init');
var config = init.getConfig();


var app = module.exports = express.createServer();

app.configure(function(){
  app.set('views',__dirname + '/views')
  app.set('view engine', 'jade')
  app.set('view options', { layout: false })
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

// Routes
app.get('/',function(req, res){
  res.render('home.jade',{})
})

/*
* Get Txs that spends a specific tx (only one level)
*/
app.get('/json/tx/:txHash', function(req, res, next){
  var hash = req.params.txHash;
  console.log(hash)
  db.open(function(err, db) {
    db.collection('spentdb', function(err, collection) {
      collection.find({prev_txhash:hash}).toArray(function(err, results) {
        if (err) return console.log(err)
        db.close()
        res.write(JSON.stringify(results))
        res.end()
      });
    })
  })
});


/*
* Get Tx tree that spends a specific tx
*/
app.get('/json/txSpentTree/:txHash', function(req, res, next){
  var hashToSpend = req.params.txHash;
  Step(
    function openDB (){
      db.open(this)
    },
    function(err, db) {
      if (err) { console.log(err); return; }
      db.collection('spentdb', this)
    },
    function (err,collection){
      getTxChildren(collection,[],hashToSpend,this);
    },
    function finished(err,txTree){
      if (err) return console.log(err)
      console.log(txTree)
      var sortedTx = toposort(txTree)
      db.close()
      res.write(JSON.stringify(sortedTx))
      res.end()
    }
  )
});


/*
* Recursion function for grabing spent Txs
*/
function getTxChildren(collection,txTree,hash,callback){
  var currentHash = hash
  Step(
    function(){
      collection.find({prev_txhash:currentHash}).toArray(this)
    },
    function getTx(err, results){
      if (err) { console.log(err); return; }
      var group = this.group();
      console.log('phase: '+ currentHash +' outputs: '+results.length)
      for (var i =  0; i < results.length; i++) {
        var spendingHash = results[i].txhash
        var hashToSpend = results[i].prev_txhash
        txTree.push([hashToSpend,spendingHash])
        getTxChildren(collection,txTree,spendingHash,group())
      }
    },
    function finished(err,tx2Tree){
      callback(err,txTree);
    }
  );
}

var rpcClient = new RpcClient(config.jsonrpc.port, config.jsonrpc.host,
                              config.jsonrpc.username, config.jsonrpc.password);

var rpc = rpcClient.connectSocket();
rpc.on('connect', function () {
  var moduleSrc = fs.readFileSync(__dirname + '/query.js', 'utf8');
  rpc.call('definerpcmodule', ['explorer', moduleSrc], function (err) {
    if (err) {
      console.error('Error registering query module: '+err.toString());
    }

    var arguments = process.argv.splice(2);

    switch(arguments[0]){
      case 'create':
        console.log('starting to build spending db')
        var genesis = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'  
        db.open(function(err, db) {
          db.collection('lastpared', function(err, collection) {
            collection.find({name:'lastHash'}).toArray(function(err, results) {
              if (err) return console.log(err);
              //db.close()
              if (results[0])
                everParseBlock(results[0].hash)
              else
                everParseBlock(genesis)
            });
          })
        })
        break;
      case 'drop':
        dropCollection()
        break
      default:
        console.log('if you want to delete or create the index db than run')
        console.log('drop: node app.js drop')
        console.log('create: node app.js create')
        if (!module.parent) {
          app.listen(3333);
          console.info("Express server listening on port " + 3333);
        }
    }
  });
});

function dropCollection (argument) {
  db.open(function(err, db) {
    db.collection('spentdb',function(err, collection) {
      collection.remove({}, function(err, result) {
        if (err) return console.log(err);
        console.log('COLLECTION REMOVED spentdb');
        db.collection('lastpared',function(err, collection) {
          collection.remove({}, function(err, result) {
            if (err) return console.log(err);
            console.log('COLLECTION REMOVED lastpared');
            db.close()
            process.kill();
          })
        })
      })
    })
  });
}

function everParseBlock(blockHash){
  Step(
    function getBlock() {
      hash = Util.decodeHex(blockHash).reverse();
      var hash64 = hash.toString('base64');
      rpc.call('explorer.blockquery', [hash64], this)
    },
    function parseBlock (err, block) {
      if (err) return console.log(err);
      this.b = block
      console.log('grabbed block: '+block.block.height+' hash: '+block.block.hash+' txs count:'+block.txs.length)
      var group = this.group();
      block.txs.forEach(function (tx) {
        hash = Util.decodeHex(tx.hash).reverse();
        var hash64 = hash.toString('base64');
        rpc.call('explorer.txquery', [hash64], group())
      })
    },
    function getCollection (err,txs){
      if (err) return console.log(err);
      var insertGroup = this.group();
      db.collection('spentdb', function (err, collection){
        if (err) return console.log(err);
        txs.forEach(function(tx){
          for (var i = 0; i < tx.tx.in.length; i++) {
            var rec =
              { prev_txhash : tx.tx.in[i].prev_out.hash
              , prev_out_index : i
              , txhash : tx.tx.hash
              }
            collection.update(
                { prev_txhash : tx.tx.in[i].prev_out.hash
                , prev_out_index : i
                , txhash : tx.tx.hash
                }
                , rec
                , {upsert:true}
                , insertGroup()
            );
          };
        })
      })
    },
    function parseNextBlock (err,results){
      var block = this.b
      if (block.nextBlock) {
          db.collection('lastpared', function(err, collection) {
            collection.update(
                {name:'lastHash'}
                , {name:'lastHash',hash:block.nextBlock.hash}
                , {upsert:true}
                , function(err, ress){
                    if (err) return console.log(err);
                    everParseBlock(block.nextBlock.hash)
                  }
            );
          })
      } else {
        console.log('finished');
      }
    }
  );
}