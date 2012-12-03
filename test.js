
/**
 * Module dependencies.
 */

var express = require('express');
var winston = require('winston');
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

var rpcClient = new RpcClient(config.jsonrpc.port, config.jsonrpc.host,
                              config.jsonrpc.username, config.jsonrpc.password);

var rpc = rpcClient.connectSocket();

rpc.on('connect', function () {
  var moduleSrc = fs.readFileSync(__dirname + '/query.js', 'utf8');
  rpc.call('definerpcmodule', ['explorer', moduleSrc], function (err) {
    if (err) {
      console.error('Error registering query module: '+err.toString());
    }
  });
});

// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

// Routes

app.get('/', function(req, res, next){
  rpc.call('explorer.indexquery', [10], function (err, result) {
    if (err) {
      next(err);
      return;
    }
    result.title = 'Home - Bitcoin Explorer';
    res.render('index', result);
  });
});

app.get('/makeSpentDB/',function(req,res){
  hash = Util.decodeHex('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f').reverse();
  var hash64 = hash.toString('base64');
  rpc.call('explorer.blockquery', [hash64], function (err, block) {
    if (err) return next(err);
    console.log(block.nextBlock)
    for (var i = block.txs.length - 1; i >= 0; i--) {
        hash = Util.decodeHex(block.txs[i]).reverse();
        var hash64 = hash.toString('base64');
        console.log(hash64)
        rpc.call('explorer.txquery', [hash64], function (err, tx) {
          if (err) return next(err);
          console.log(tx);
          db.open(function(err, db) {
            db.collection('spentdb', function(err, collection) {
              // collection.insert(
              //   { prev_txhash :
              //   , prev_out_index :
              //   , txhash : tx.
              //   }
              // )
              db.close()
            })
          });
        });
    };
    res.write('next block : ' + block.nextBlock);
    res.end();
  });
})



app.get('/testDBin',function(req,res){
  db.open(function(err, db) {
    db.collection('test', function(err, collection) {
      collection.remove(function(err, result){
        collection.insert({'a':1})
        collection.insert({'a':2})
        collection.insert({'a':3})
        db.close()
        res.write('insed')
        res.end()
      })
    })
  });
})

app.get('/testDBf',function(req,res){
  db.open(function(err, db) {
    db.collection('test', function(err, collection) {
      collection.find().toArray(function(err, results) {
        for (var i = results.length - 1; i >= 0; i--) {
          res.write(results[i].a+'\n');
        }
        db.close()
        res.end();
      });
    })
  })
})



// Only listen on $ node app.js

if (!module.parent) {
  app.listen(3000);
  winston.info("Express server listening on port " + 3000);
}
