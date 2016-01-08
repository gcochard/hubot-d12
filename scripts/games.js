// Description:
//   gamemaster
//
// Dependencies:
//   lodash
//   request
//
// Commands:
//   hubot open the <door type> doors - Opens doors
//   hubot who's turn is it - returns the current player's turn
//   hubot yell at <user> - reminds the user it is their turn
//   hubot start game <id> - sets the game id to <id>
//   hubot start game - enters interactive mode to start game
//   hubot current game - replies with the game id
//   hubot finish game - unsets the game id
//   hubot rank - replies with the current game rankings
//   hubot coin flip - replies with heads or tails
//   hubot random me <min,max[,num[,sets]]> - replies with <set> sets of <num> numbers, within the min and max range
//   hubot random quota - replies with the current bit quota
//   hubot alias me <name> - aliases you name for detection of turns
//   hubot unalias <name> - forgets alias
//   hubot show aliases - lists known aliases for a user
'use strict';
var _ = require('lodash');
var request = require('request');
var vm = require('vm');
var path = require('path');
var util = require('util');
var url = require('url');
var gameRoom = '#games';
var hereMention = '@channel';
var interval;

module.exports = function(robot) {

    var aliases = {
        'greg': 'greg',
        'ryan': 'rmilbourne',
        'kevin': 'kevin',
        'matt': 'mmacfreier',
        'jonathan': 'jobratt',
        'justin': 'hustin',
        'suntan':'suntan'
    };
    function formatMessage(username){
        var name = robot.brain.data.turnOrder.split(' ')[username];
        if(name){
            return {message:'@'+name+' it\'s your turn',username:name};
        }
        // dereference aliases as long as they exist
        // don't be dumb and put in circular references
        name = username;
        //while(aliases[name]){
        //    name = aliases[name];
        //}
        if(name){
            return {message:'@'+name+' it\'s your turn',username:name};
        }
        return {message:'@'+username+' it\'s your turn',username:username};
    }

    function detectWinner(teams){
        var winnerIndex = _.findIndex(teams,function(v){ return v.status === 8; });
        var winnerName;
        if(winnerIndex !== -1){
            winnerName = robot.brain.data.turnOrder.split(' ')[winnerIndex];
            robot.messageRoom(gameRoom, hereMention+' Game over! @'+winnerName+' won!');
            robot.brain.data.currentGame = null;
            robot.brain.data.currentPlayer = null;
            robot.brain.data.winners = robot.brain.data.winners || [];
            robot.brain.data.winners.push(winnerName);
            robot.brain.data.record = robot.brain.data.record || {};
            robot.brain.data.record[winnerName] = robot.brain.data.record[winnerName] || 0;
            robot.brain.data.record[winnerName]++;
            clearInterval(interval);
            return true;
        }
        return false;
    }

    function detectPlayer(teams){
        var currIndex = _.findIndex(teams,function(v){ return v.status === 3; });
        if(currIndex !== -1){
            if(robot.brain.data.currIndex === currIndex){
                return -1;
            }
            robot.brain.data.currIndex = currIndex;
            robot.brain.data.currentPlayer = robot.brain.data.turnOrder.split(' ')[currIndex];
            return currIndex;
        }
        return robot.brain.data.currIndex;
    }

    var sandbox = vm.createContext({
        callback: function(obj){
            var teams = obj.teams;
            var currWinner = detectWinner(teams);
            if(currWinner){
                return null;
            }
            var currPlayer = detectPlayer(teams);
            if(currPlayer === -1){
                return 'it is '+formatMessage(robot.brain.data.currIndex).username+'\'s turn';
            }
            return formatMessage(currPlayer).message;
        },
        callbackInterval: function(obj){
            var teams = obj.teams;
            var currWinner = detectWinner(teams);
            if(currWinner){
                return null;
            }
            var currPlayer = detectPlayer(teams,true);
            if(currPlayer === -1){
                return null;
            }
            return formatMessage(currPlayer).message;
        },
        newgameCallback: function(obj){
            if(obj.success !== true){
                return obj.message;
            }
            var gameId = obj.gameId;
            clearInterval(interval);
            robot.brain.data.currentGame = gameId;
            return "Current game id set to "+gameId;
        }

    });

    var quotaExhausted = false;
    var quotaExhaustedError = new Error('quota has been exhausted, ignoring request');
    function getQuota(cb){
        if(quotaExhausted){
            robot.logger.error('quota exhausted, deferring...');
            return cb(quotaExhaustedError);
        }
        return request('https://www.random.org/quota/?format=plain',function(err,res,body){
            if(err){
                robot.logger.error('error while getting quota: '+err.message);
                return cb(err);
            }
            robot.logger.info('quota: %d',body);
            if(/^-\d/.test(body)){
                quotaExhaustedError.quota = body;
                quotaExhausted = true;
                // wait at least 10 minutes before checking again...
                // http://www.random.org/clients/http/#quota
                robot.logger.error('quota exhausted, waiting 10 minutes');
                setTimeout(function(){
                    quotaExhausted = false;
                },10*60*1000);
                return cb(quotaExhaustedError,body);
            }
            return cb(null,body);
        });
    }

    function getRandom(min,max,cols,rows,cb){
        var count = cols*rows;
        var randomorg = util.format('https://www.random.org/integers/?col=%d&num=%d&min=%d&max=%d&format=plain&rnd=new&base=10',cols,count,min,max);
        robot.logger.info(randomorg);
        return getQuota(function(qerr){
            if(qerr){
                robot.logger.error('error during quota check: '+qerr.message);
                return cb(qerr);
            }
            return request({url:randomorg,agent:false,headers:{Accept:'*/*'}},function(err,res,body){
                if(err){
                    robot.logger.error('error during random request: '+err.message);
                    return cb(err);
                }
                robot.logger.info('error: %s',util.inspect(err));
                robot.logger.info('res: %s',util.inspect(res));
                robot.logger.info('body: %s',util.inspect(body));
                if(/Error:/.test(body)){
                    robot.logger.error('random gave error: '+body);
                    // always make first cb arg an instanceof Error
                    return cb(new Error(body));
                }
                return cb(null,body.split('\n').map(function(s){ return s.split('\t'); }));
            });
        });
    }

    function checkWebsite(send,frominterval){
        var nonce = Date.now();
        var callback = 'callback';
        if(frominterval){
            callback = 'callbackInterval';
        }
        var currentGameUrl = 'http://gamesbyemail.com/Games/GameMethods.aspx?noCache='+nonce+'&callback='+callback+'&function=GetGame&argCount=1&args=%5B%22'+robot.brain.data.currentGame+'%22%5D';
        return request(currentGameUrl,function(err,res,body){
            if(err){
                robot.logger.error(err.message);
                return send('I couldn\'t find that info, sorry, '+err.message);
            }
            var message = vm.runInNewContext(body,sandbox);
            if(message){
                send(message);
            } else if (!frominterval){
                send('I couldn\'t find that info, sorry');
            } else {
                robot.logger.error('message undefined');
            }
        });
    }

    var d12Users = {
        mmacfreier:'Matt',
        kwren:'Kevin',
        gcochard:'Greg',
        justinb:'BassJustin',
        ryanbmilbourne:'Ryan',
        jobratt:'Jonathan'
    };
    function checkD12(send,gameId,frominterval){
        var nonce = Date.now();
        var callback = 'callback';
        if(frominterval){
            callback = 'callbackInterval';
        }
        var currentGameUrl = 'http://dominating12.com/lib/ajax/game/play.php';
        return request.post(currentGameUrl,{form:{
            id:gameId,
            view:1,
            status:2,
            troops:0,
            territories:0,
            time:0,
            players:1,
            cworth:0,
            cards:1,
            mapSize:1,
            notLobby:1
        }},function(err,res,body){
            if(err){
                robot.logger.error(err.message);
                return send('I couldn\'t find that info, sorry, '+err.message);
            }
            robot.logger.info(gameId);
            //robot.logger.info(body);
            var currPlayers = robot.brain.get('currentPlayers') || {};
            var relevant = body.match(/updateGamePlayers\(([^;]+)\)/);
            robot.logger.info(relevant);
            relevant = relevant && relevant[1];
            if(!relevant){
                return send('I couldn\'t find that info, sorry, response: '+relevant);
            }
            try{
                relevant = eval(relevant);
                robot.logger.info(relevant);
            } catch(e){
                robot.logger.error(e.message);
                return send('I couldn\'t find that info, sorry, '+e.message);
            }
            var message = '';
            var newPlayer = relevant.filter(function(item){
                return !!item[6];
            })[0];
            if(newPlayer.length){
                newPlayer = newPlayer[1];
            } else {
                var winner = body.match(/winningTeam = (\d)/);
                if(winner && winner.length){
                    winner = winner[1];
                }
                var winnerName = d12Users[relevant[winner][1]];
                delete currPlayers[gameId];
                robot.brain.set('currentPlayers',currPlayers);
                return robot.messageRoom(gameRoom, hereMention+' Game over! @'+winnerName+' won!');
            }
            newPlayer = d12Users[newPlayer];
            if(newPlayer){
                var currPlayer = currPlayers[gameId] || '';
                var isNew = false;
                if(currPlayer !== newPlayer){
                    currPlayers[gameId] = newPlayer;
                    isNew = true;
                }
                message += 'it is '+(isNew?'@':'')+newPlayer+'\'s turn in game ' + gameId + ', http://dominating12.com/?cmd=game&sec=play&id=' + gameId;
                robot.brain.set('currentPlayers',currPlayers);
            }
            if(message){
                send(message);
            } else if (!frominterval){
                send('I couldn\'t find that info, sorry');
            } else {
                robot.logger.error('message undefined');
            }
        });
    }

    // only start interval on startup if there's already a game going
    /* -- commenting this out for now
    if((robot.brain.get('currentGames')||[]).length){
        clearInterval(interval);
        interval = setInterval(function(){
            checkD12(robot.messageRoom.bind(robot,gameRoom),true);
        },15*60*1000);
        checkD12(robot.messageRoom.bind(robot,gameRoom),true);
    }
    */

    robot.respond(/rank/i,function(msg){
        var ranking =
        _.map(
            _.sortBy(
                _.map(
                    robot.brain.data.record,function(num,user){
                    return {name:user,score:num};
                }),
                'score'),
            function(obj){
                return obj.name+' has '+obj.score+' wins.';
        }).join('\n');
        msg.send(ranking);
    });

    robot.respond(/random quota/i,function(msg){
        return getQuota(function(err,quota){
            if(err){
                return msg.reply(err.message+'\nquota: '+err.quota);
            }
            return msg.reply('current quota is: '+quota);
        });
    });

    robot.respond(/(flip a coin)|(coin flip)/i, function(msg) {
        return getRandom(0,1,1,1,function(err,array){
            if(err){
                robot.logger.error(err.message);
                return msg.reply('Could not get randoms...\n'+err.message);
            }
            if(array.length){
                if(array[0] instanceof Array){
                    return msg.reply(['heads','tails'][array[0][0]]);
                }
            }
            return msg.reply("I couldn't find a coin to flip!");
        });
    });

    robot.respond(/random me (-?\d+),? ?(-?\d+),? ?(\d+)?,? ?(\d+)?/i,function(msg) {
        var min = msg.match[1]
          , max = msg.match[2]
          , num = msg.match[3]
          , sets = msg.match[4]
          ;
        num = num || 1;
        sets = sets || 1;
        return getRandom(min,max,num,sets,function(err,arrays){
            if(err){
                robot.logger.error(err.message);
                return msg.reply('Could not get randoms...\n'+err.message);
            }
            var messages = [];
            _.each(arrays,function(set){
                if(set.length){
                    var message = set.join(', ');
                    if(message){
                        messages.push(message);
                    }
                }
            });
            if(messages.length){
                return msg.reply('\n'+messages.join('\n'));
            }
        });
    });

    robot.respond(/open the (.*) doors/i, function(msg) {
        var doorType = msg.match[1];
        if(doorType === "pod bay"){
            msg.reply("I'm afraid I can't let you do that.");
        }
        else{
            msg.reply("Opening "+doorType+" doors");
        }
    });

    robot.respond(/current game/i,function(msg) {
        msg.reply("current game is "+robot.brain.data.currentGame);
    });

    robot.respond(/start game (.*)/i, function(msg) {
        var gameId = msg.match[1];
        clearInterval(interval);
        robot.brain.data.currentGame = gameId;
        msg.reply("Current game id set to "+gameId);
        msg.reply("Please reply with turn order in the form 'JohnDoe JaneDoe MarkDankberg SteveJobs' using hipchat mention names");
    });

    var repl = false;
    // FSM to start a game
    var fsmState = null;
    // defaults for game vars
    var gameVars = {
        // gameType: {16:'Gambit',17:'Dark Gambit',18:'Blind Gambit',19:'Spy Gambit'}
        gameType: 17
      , gameTitle: 'Untitled Game'
      , gameMessage: ''
        // player schema: {title:String,id:String (email),mode:{1|2}} mode 1: starter
      , players: []
      , numberOfDistinctPlayers: 4
      , info: {
            // peeking/airstrikes are boolean
            b_xPeek: false
          , b_airstrikes: false
            // startType: ['territories','territoriesArmies']
          , startType: 'territories'
            // tradeIn: ['uncapped','fixed','capped']
          , tradeIn: 'fixed'
            // only used when tradeIn is 'capped'
          , i_tradeInCap: 30
            // the following 4 are only used when tradeIn is 'fixed'
          , i_artillery: 4
          , i_infantry: 6
          , i_cavalry: 8
          , i_each: 10
      }
    };

    var startGame = function(msg){
        gameVars = gameVars || {};
        var args = util.inspect([gameVars],{depth:Infinity}).
            replace(/\n */g,'').
            replace(/'/g,'"').
            replace(/: /g,':').
            replace(/{ /g,'{').
            replace(/\[ /g,'[').
            replace(/, /g,',').
            replace(/ }/g,'}').
            replace(/ ]/g,']');
        console.log(args);
        request.post('http://gamesbyemail.com/Games/GameMethods.aspx?noCache='+Date.now(), {form:{
              callback: 'newgameCallback'
            , "function": 'CreateGame'
            , argCount: 1
            , args: args
        }}, function(err,response,body){
            console.log(err && err.message);
            if(err){
                return msg.reply(util.format('error starting game: %s',err.messge));
            }
            console.log(body);
            var message = vm.runInNewContext(body,sandbox);
            if(message){
                msg.send(message);
            } else {
                robot.logger.error('message undefined');
            }
        });
    };

    var emails = {
        gregcochard: 'greg.cochard@viasat.com',
        ryanmilbourne: 'ryan.milbourne@viasat.com',
        kevinwren: 'kevin.wren@viasat.com',
        mattmacfreier: 'matt.macfreier@viasat.com',
        jonathanbratt: 'jonathan.bratt@viasat.com'
    };

    var gameTypes = {standard:16,dark:17,blind:18,spy:19};
    var states = {
        start_game: function(msg){
            repl = true;
            fsmState = 'game_type';
            msg.reply('entering interactive mode, reply "hubot cancel" to cancel game creation');
            msg.reply('Please reply with game type in the form "hubot game type <Standard|Dark|Blind|Spy>"');
        },
        game_type: function(msg){
            var gameType = (msg.match[1] || '').toLowerCase();
            if(!gameTypes.hasOwnProperty(gameType)){
                // do not pass go, do not collect 200 dollars
                msg.reply('invalid game type! Please reply with "hubot game type <type>"');
                return;
            }
            gameVars.gameType = gameTypes[gameType];
            var initCapGameType = gameType.split('');
            initCapGameType[0] = initCapGameType[0].toUpperCase();
            gameType = initCapGameType.join('');
            msg.reply('Set game type to '+gameType+' Gambit');
            fsmState = 'turn_order';
            msg.reply('Please reply with turn order in the form "hubot turn order JohnDoe JaneDoe MarkDankberg SteveJobs"');
        },
        turn_order:function(msg){
            var order = msg.match[0].replace(/^.*turn order /,'').split(' ');
            if( 6 < order.length || order.length < 2){
                // do not pass go, do not collect 200 dollars
                msg.reply('invalid turn order! Please reply with "hubot turn order JohnDoe JaneDoe MarkDankberg SteveJobs"');
                return;
            }
            var players = order.map(function(s){
                if(s.indexOf('@')===0){
                    s = s.slice(1);
                }
                return s.toLowerCase();
            });
            var playerEmails = players.map(function(s){ return emails[s]; });
            gameVars.players = [];
            /* players:[
             *   {title:"fdsa1",id:"greg.cochard@gmail.com",mode:1},
             *   {title:"fdsa2",id:"cliffhopper@gmail.com",mode:2},
             *   {title:"fdsa3",id:"gregcochard@gmail.com",mode:2},
             *   {title:"fdsa4",id:"cliff.hopper@gmail.com",mode:2}
             * ]
             */
            _.each(playerEmails,function(email,index){
                gameVars.players.push({title:'',id:email,mode:index===0?1:2});
            });
            gameVars.numberOfDistinctPlayers = gameVars.players.length;
            robot.brain.data.turnOrder = order.join(' ');
            msg.reply('Set turn order to '+robot.brain.data.turnOrder.split(' ').join(', '));
            msg.reply('Please reply with airstrikes in the form "hubot airstrikes <on|off>"');
            fsmState = 'airstrikes';
        },
        airstrikes:function(msg){
            var airstrikes = msg.match[1];
            gameVars.info.b_airstrikes = airstrikes.toLowerCase() === 'on';
            msg.reply('Turned airstrikes '+airstrikes);
            msg.reply('Please reply with peeking in the form "hubot peeking <on|off>"');
            fsmState = 'peeking';
        },
        peeking:function(msg){
            var peeking = msg.match[1];
            gameVars.info.b_xPeek = peeking.toLowerCase() === 'on';
            msg.reply('Turned peeking '+peeking);
            msg.reply('Please reply with card trade type in the form "hubot trade <capped|uncapped|fixed>"');
            fsmState = 'trade';
        },
        trade:function(msg){
            var type = msg.match[1];
            if(type.toLowerCase() === 'uncapped'){
                fsmState = 'game_name';
                msg.reply('Set cards to uncapped');
                return msg.reply('Please reply with game name in the form "hubot game name <name of the game>"');
            }
            fsmState = 'values';
            if(type.toLowerCase() === 'capped'){
                return msg.reply('Please reply with card max trade value in the form "hubot value <number>"');
            }
            return msg.reply('Please reply with card trade values in the form "hubot values <num> <num> <num>"');
        },
        values:function(msg){
            var values = msg.match[0].replace(/hubot values? ?/,'');
            var cardValues = values.split(' ');
            if(cardValues.length === 1){
                // we are capped, warn if we were expecting fixed
                if(gameVars.info.tradeIn !== 'capped'){
                    msg.reply('Expected a single integer value, but got '+values);
                    msg.reply('Please reply with "hubot trade <type>" if you want to change trade-in type');
                    msg.reply('Please reply with "hubot value <number>" if you want to keep capped trade-in');
                    return null;
                }
                gameVars.info.i_tradeInCap = +cardValues[0];
                msg.reply(util.format('Set trade cap to %d',cardValues[0]));
            } else {
                if(gameVars.info.tradeIn !== 'fixed'){
                    msg.reply('Expected three integer values, but got '+values);
                    msg.reply('Please reply with "hubot trade <type>" if you want to change trade-in type');
                    msg.reply('Please reply with "hubot values <number number number>" if you want to keep fixed trade-in');
                    return null;
                }
                gameVars.info.i_artillery = +cardValues[0];
                gameVars.info.i_infantry = +cardValues[1];
                gameVars.info.i_cavalry = +cardValues[2];
                gameVars.info.i_each = +cardValues[3];
                msg.reply(util.format('Set trade values to artillery: %d, infantry: %d, cavalry: %d, all: %d',cardValues[0],cardValues[1],cardValues[2],cardValues[3]));
            }
            //we are fixed
            fsmState = 'game_name';
            return msg.reply('Please reply with game name in the form "hubot game name <name of the game>"');
        },
        game_name: function(msg){
            gameVars.gameTitle = msg.match[1];
            fsmState = 'player_names';
            msg.reply(util.format('Set game name to %s',msg.match[1]));
            return msg.reply('Please reply with player names in the form "hubot player names "Player1" "player 2" "player name 3" ...etc"');
        },
        player_names: function(msg){
            var playerNames = msg.match[0].replace(/hubot player names /i,'');
            playerNames = playerNames.split('" "');
            if(playerNames.length !== gameVars.players.length){
                msg.reply(util.format('Player name length (%d) must equal turn order length (%d)!',playerNames.length,gameVars.players.length));
                return msg.reply('Please reply with player names in the form "hubot player names "Player1" "player 2" "player name 3" ...etc"');
            }
            _.each(playerNames,function(name,i){
                name = name.replace(/^"/,'');
                name = name.replace(/"$/,'');
                gameVars.players[i].title = name;
            });
            fsmState = 'show_summary';
            return states.show_summary(msg);

        },
        show_summary: function(msg){
            msg.reply('Game construction completed, summary will follow; please reply with "hubot commit game" to start');
            msg.reply(util.inspect(gameVars));
            fsmState = 'commit';
        },
        commit: function(msg){
            msg.send('Game committed, '+hereMention+' starting new game...');
            repl = false;
            fsmState = null;
            startGame(msg);
        },
        cancel: function(msg){
            repl = false;
            fsmState = null;
            msg.reply('Cancelled game creation. Please come again!');
        }
    };

    robot.respond(/start game$/i, states.start_game);
    robot.respond(/game type ((standard)|(dark)|(blind)|(spy))+/i, states.game_type);
    //-- handled below, proxies to states.turn_order robot.respond(/turn order (\d)+/i, states.turn_order);
    robot.respond(/airstrikes ((on|off))/i, states.airstrikes);
    robot.respond(/peeking ((on|off))/i, states.peeking);
    robot.respond(/trade ((fixed)|(uncapped)|(capped))/i, states.trade);
    robot.respond(/values? (\d+ ?)+/i, states.values);
    robot.respond(/game name (.*)$/i, states.game_name);
    robot.respond(/player names ("[^"]*" ?)+/i, states.player_names);
    robot.respond(/commit/i, states.commit);
    robot.respond(/cancel/i, states.cancel);

    robot.respond(/(finish)|(end) game/i, function(msg) {
        robot.brain.data.currentGame = null;
        robot.brain.data.currentPlayer = null;
        clearInterval(interval);
        msg.reply('Game Over!');
    });

    robot.respond(/who'?se? turn is it/i, function(msg) {
        if(!Object.keys(robot.brain.get('currentPlayers')||{}).length){
            return msg.reply("I am not tracking any games!");
        }
        var match = msg.match[0].match(/in game (\d)+/);
        if(match && match[1]){
            checkD12(msg.send.bind(msg),match[1],false);
        } else {
            Object.keys(robot.brain.get('currentPlayers')).forEach(function(game){
                checkD12(msg.send.bind(msg),game,false);
            });
        }
    });

    // this is most likely jsonp so abuse it as such
    robot.router.get('/hubot/checkturn',function(req,res){
        res.header('content-type','text/plain');
        res.header('Access-Control-Allow-Origin','*');
        var response = 'date: '+ Date.now() + '\n' + 'hubot will check turns now';
        robot.logger.info('checking website after webhook');
        res.send(response);
        checkWebsite(robot.messageRoom.bind(robot,gameRoom),true);
    });

    robot.router.get('/hubot/checkturn/d12',function(req,res){
        res.header('content-type','text/plain');
        res.header('Access-Control-Allow-Origin','*');
        var response = 'date: '+ Date.now() + '\n' + 'hubot will check turns now';
        robot.logger.info('checking website after webhook');
        res.send(response);
        checkWebsite(robot.messageRoom.bind(robot,gameRoom),true);
    });

    function serveScript(name,req,res){
        res.sendfile(path.resolve(__dirname,'..','static',name));
    }
    robot.router.options('/hubot/treaties',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','GET, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.end();
    });
    robot.router.get('/hubot/treaties', function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('content-type','application/json');
        var treaties = robot.brain.get('treaties');
        res.send(JSON.stringify(treaties));
    });
    robot.router.options('/hubot/pushturn',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','GET, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.end();
    });
    robot.router.get('/hubot/pushturn',function(req,res){
        res.header('content-type','text/plain');
        res.header('Access-Control-Allow-Origin','*');
        var response = 'date: '+ Date.now() + '\n' + 'hubot will announce player now';
        res.send(response);
        var payload = req.query.user;
        var ref = req.get('referrer');
        var refObj = url.parse(ref,true);
        var game = refObj.query.id;
        robot.logger.info('announcing game '+game+' turn');
        var currPlayers = robot.brain.get('currentPlayers') || {};
        robot.logger.info(currPlayers);
        if(currPlayers[game] !== payload){
            currPlayers[game] = payload;
            robot.brain.set('currentPlayers',currPlayers);
            if(!(/^@/.test(payload))){
                payload = '@'+payload;
            }
            payload += ' it\'s your turn in game ' + game + ', http://dominating12.com/?cmd=game&sec=play&id=' + game;
            robot.messageRoom(gameRoom,payload);
        }
    });
    robot.router.options('/hubot/pushdice',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','OPTIONS, POST');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.end();
    });
    robot.router.post('/hubot/pushdice',function(req,res){
        res.header('content-type','text/plain');
        res.header('Access-Control-Allow-Origin','*');
        var response = 'date: '+ Date.now() + '\n' + 'hubot saved statistics';
        var player = req.body.player;
        var ref = req.get('referrer');
        var refObj = url.parse(ref,true);
        var game = refObj.query.id;
        var stats = robot.brain.get('stats') || {};
        stats[game] = stats[game] || [];
        stats[game].push(req.body);
        robot.brain.set('stats',stats);
        response += '\n'+JSON.stringify(stats);
        res.send(response);
    });

    robot.router.get('/hubot/dice',function(req,res){
        var stats = robot.brain.get('stats') || {};
        if(req.query.game){
            stats = stats[req.query.game] || stats;
        }
        res.send(stats);
    });
    robot.router.get('/hubot/checkturnscript.js',serveScript.bind(null,'checkturnscript.js'));
    robot.router.get('/hubot/checkturnscript.user.js',serveScript.bind(null,'checkturnscript.js'));
    robot.router.get('/hubot/d12.user.js',serveScript.bind(null,'d12.user.js'));
    robot.router.get('/hubot/d12.inject.user.js',serveScript.bind(null,'d12.inject.user.js'));

    robot.respond(/turn order( [^ ]+){2,6}/i, function(msg) {
        if(repl && fsmState === 'turn_order' && !robot.brain.data.currentGame){
            return states.turn_order(msg);
        }
        var order = msg.match[0].replace(/^.*turn order /,'').split(' ');
        order = order.map(function(s){
            if(s.indexOf('@')===0){
                return s.slice(1);
            }
            return s;
        });
        if(2 <= order.length && order.length <= 6){
            robot.brain.data.turnOrder = order.join(' ');
            msg.reply('Set turn order to '+robot.brain.data.turnOrder.split(' ').join(', '));
            // first set the interval...
            clearInterval(interval);
            interval = setInterval(function(){
                checkWebsite(robot.messageRoom.bind(robot,gameRoom),true);
            },15*60*1000);
            // ...then fire off a check right now
            checkWebsite(robot.messageRoom.bind(robot,gameRoom),true);
        }
    });

    robot.hear(/turn order\?/i, function(msg){
        msg.reply('Turn order is currently '+robot.brain.data.turnOrder.split(' ').join(', '));
    });

    robot.brain.data.tahitis = robot.brain.data.tahitis || 0;
    robot.hear(/tahiti/i, function(msg){
        if(robot.brain.data.tahitis < 10){
            robot.brain.data.tahitis++;
            msg.send("It's a magical place.");
            if(robot.brain.data.tahitis === 10) {
                msg.send("-- I keep saying that!");
            }
        }
    });

    function sTuPiDcAsE(text,start){
        return _.map(text.split(''),function(v,i){
            i += start?0:1;
            return i%2?v.toLowerCase():v.toUpperCase();
        }).join('');
    }

    function matchFormat(text,msg){
        var len = (msg.match[0].match(/!/g)||[]).length;
        var bangs = len?new Array(len+1).join('!'):'.';
        text = text + bangs;
        if(/^[A-Z !]+$/.test(msg.match[0])){
            return text.toUpperCase();
        }
        var test = msg.match[0].replace(/[^a-z]/gi,'');
        var odds = _.filter(test.split(''),function(v,k){
            return k % 2;
        }).join('');
        var evens = _.filter(test.split(''),function(v,k){
            return (k+1) % 2;
        }).join('');
        if(/^[a-z]+$/.test(evens) && /^[A-Z]+$/.test(odds)){
            return sTuPiDcAsE(text,false);
        }
        if(/^[a-z]+$/.test(odds) && /^[A-Z]+$/.test(evens)){
            return sTuPiDcAsE(text,true);
        }
        return text;
    }

    robot.respond(/hostname/i, function(msg) {
        msg.send(require('os').hostname());
    });

    robot.respond(/yell( at)? ?(.*)!?/i, function(msg) {
        var user = msg.match[2];
        while(/!$/.test(user)){
            user = user.slice(0,-1);
        }
        if(!user){
            return msg.reply(matchFormat('yelling',msg));
        }
        if(/^me$/i.test(user)){
            return msg.reply(matchFormat('yelling',msg));
        }
        if(!robot.brain.data.currentGame){
            return msg.reply(matchFormat('I am not tracking a game',msg));
        }
        var currentPlayer = robot.brain.data.currentPlayer;
        var resp = formatMessage(user);
        if(resp.message){
            if(formatMessage(detectPlayer(currentPlayer)).username !== resp.username){
                return msg.reply(matchFormat('It\'s not their turn',msg));
            }
            return robot.messageRoom(gameRoom, matchFormat(resp.message,msg));
        }
        return msg.reply(matchFormat('I don\'t know who '+user+' is',msg));
    });

    var asked = 0;
    robot.respond(/(identify yourself)|(who are you)|(what is your name)/i,function(msg){
        if(asked++){
            return msg.send('We are Hugh');
        }
        return msg.send('Hugh');
    });

    robot.hear(/not a( valid)? borg/i,function(msg){
        if(asked){
            setTimeout(msg.send.bind(msg,'...Third of Five'),2000);
            asked = 0;
        }
    });

    var debugged = 0;

    robot.respond(/debug me /i,function(msg){
        switch(++debugged){
        case 1:
            msg.reply('user: '+msg.user);
            break;
        case 2:
            msg.reply('message: '+msg.message);
            break;
        case 3:
            msg.reply('mention_name: '+msg.mention_name);
            break;
        default:
            debugged = 0;
            break;
        }
    });
};
