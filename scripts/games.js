// Description:
//   gamemaster
//
// Dependencies:
//   lodash
//   request
//   array-difference
//   d12maps
//
// Commands:
//   hubot open the <door type> doors - Opens doors
//   hubot who's turn is it - returns the current player's turn
//   hubot yell at <user> - reminds the user it is their turn
//   hubot start game <id> - sets the game id to <id>
//   hubot restart game <id> - marks the game <id> as in progress
//   hubot set verbose game <id> - sets the game <id> to verbose (announces turn starts and finishes)
//   hubot get verbose game <id> - gets the game <id> verbose flag
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
/*eslint-env node*/
var _ = require('lodash');
var request = require('request');
var vm = require('vm');
var path = require('path');
var util = require('util');
var diff = require('array-difference');
var fetchd12 = require('../utils/fetchD12Log');
var fetchD12Log = fetchd12.fetchLog
var cachedFetchLog = fetchd12.cachedFetchLog
var fetchOrder = fetchd12.fetchOrder
var gameRoom = '#games';
var hereMention = '@channel:';
var interval;
var baseRate = 15;

module.exports = function(robot) {

    var d12Users = {
        mmacfreier:'mmacfreier',
        kwren:'kwren',
        gcochard:'greg',
        greg:'gcochard',
        justinb:'justin',
        justin:'justinb',
        tanleach1001:'suntan',
        suntan:'tanleach1001',
        ryan:'ryanbmilbourne',
        jobratt:'jobratt',
        johnsgill3: 'johnsgill3',
        terryjbates: 'terryjbates'
    };

    var d12Maps = require('d12maps');

    setInterval(function(){
        var rate = robot.brain.get('rateLimit') || {};
        Object.keys(rate).forEach(function(key){
            rate[key] += baseRate;
            rate[key] = Math.min(rate[key], baseRate);
        });
        robot.brain.set('rateLimit', rate);
    }, 60000);

    var slackUsers = [
        'mmacfreier',
        'kwren',
        'greg',
        'justinb',
        'suntan',
        'ryan',
        'jobratt',
        'johnsgill3'
    ];

    function getGameData(game){
        var currMaps = robot.brain.get('currentMaps') || {}, currMap = d12Maps[currMaps[game]] || {};
        return ' in game ' + game + ', https://dominating12.com/game/' + game + ' ('+currMap.name+')';
    }

    function formatMessage(username){
        var name = d12Users[username];
        if(slackUsers.indexOf(username) >= 0){
            return {message:'@'+username+' it\'s your turn',username:username};
        }
        if(slackUsers.indexOf(name) >= 0){
            return {message:'@'+name+' it\'s your turn',username:name};
        }
        return {message:'@'+username+' it\'s your turn',username:username};
    }

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

    function getD12MapId(gameId, cb){
        var currentGameUrl = 'https://dominating12.com/api/game/'+gameId;
        return request.get(currentGameUrl,function(err,res,body){
            if(err){
                robot.logger.error(err.message);
                return cb(err);
            }
            robot.logger.info(gameId);
            robot.logger.info(body);
            if(typeof body === 'string'){
                try {
                    body = JSON.parse(body);
                } catch(e){
                    body = {};
                }
            }
            return cb(null, body.map_id);
        });
    }

    function checkD12(send,gameId){
        var currentGameUrl = 'https://dominating12.com/api/game/'+gameId;
        return request.get(currentGameUrl,function(err,res,body){
            if(err){
                robot.logger.error(err.message);
                return send('I couldn\'t find that info, sorry, '+err.message);
            }
            robot.logger.info(gameId);
            robot.logger.info(body);
            if(typeof body === 'string'){
                try {
                    body = JSON.parse(body);
                } catch(e){
                    body = {};
                }
            }
            var playerList = body.playerList || {}, players = [];
            robot.logger.info(playerList);
            // convert to real array
            Object.keys(playerList).forEach(function(p){
                players[p-1] = playerList[p];
            });
            if(body.winning_team){
                var winner = players[body.winning_team-1];
                var winnerName = d12Users[winner.username];
                return cleanupGame(gameId, winnerName);
            }
            var userOrder = _.map(playerList, 'username');
            fetchD12Log(+gameId, function(err, log){
                if(err){
                    robot.logger.error(err.message);
                    return send('I couldn\'t find that info, sorry, '+err.message);
                }
                var lastEnd = log.filter(function(l){
                    return /ended the turn/.test(l.message);
                });
                lastEnd = lastEnd.unshift();
                var currPlayers = robot.brain.get('currentPlayers') || {};
                var currPlayer = currPlayers[gameId];
                var message = '';
                if(lastEnd.player !== currPlayer){
                    message = 'last I heard, it was '+currPlayer+'\'s turn' + getGameData(gameId);
                    return send(message);
                }
                var nextPlayer = userOrder[userOrder.indexOf(currPlayer)+1 % userOrder.length];
                currPlayers[gameId] = nextPlayer;
                var payload = nextPlayer;
                robot.brain.set('currentPlayers',currPlayers);
                if(!(/^@/.test(payload))){
                    payload = '@'+payload;
                }
                payload += ' it\'s your turn' + getGameData(gameId);
                return robot.messageRoom(gameRoom,payload);

                /*
                newPlayer = d12Users[newPlayer];
                if(newPlayer){
                    var currPlayer = currPlayers[gameId] || '';
                    var isNew = false;
                    if(currPlayer !== newPlayer){
                        currPlayers[gameId] = newPlayer;
                        isNew = true;
                    }
                    robot.brain.set('currentPlayers',currPlayers);
                }
                if(message){
                    send(message);
                } else if (!frominterval){
                    send('I couldn\'t find that info, sorry');
                } else {
                    robot.logger.error('message undefined');
                }
                */
            });
        });
    }

    function cleanupGame(game,winner){
        var deaths = robot.brain.get('currentDeaths') || {};
        var players = robot.brain.get('currentPlayers') || {};
        var treaties = robot.brain.get('treaties') || {};
        var finished = robot.brain.get('finishedGames') || {};
        var current = robot.brain.get('currentGames') || {};
        var maps = robot.brain.get('currentMaps') || {};
        Object.keys(treaties).forEach(function(id){
            if(treaties[id] && treaties[id].game === game){
                delete treaties[id];
            } else if(!treaties[id]){
                // wtf???
                robot.logger.error('WTF? treaties[id] is null, id: %s',id);
                delete treaties[id];
            }
        });
        delete deaths[game];
        delete players[game];
        delete current[game];
        delete maps[game];
        finished[game] = true;
        robot.brain.set('treaties',treaties);
        robot.brain.set('currentDeaths',deaths);
        robot.brain.set('currentGames',current);
        robot.brain.set('finishedGames',finished);
        robot.brain.set('currentPlayers',players);
        robot.brain.set('currentMaps',maps);
        if(winner instanceof Array){
            winner = winner.map(function(w){
                if(!(/^@/.test(w))){
                    w = '@'+w;
                }
                return w;
            }).join(', ');
        }
        if(!(/^@/.test(winner))){
            winner = '@'+winner;
        }
        var payload = hereMention+' game ' + game + ' is over! ' + winner + ' has won!';
        return robot.messageRoom(gameRoom,payload);
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
            return msg.reply('I couldn\'t find a coin to flip!');
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
        if(doorType === 'pod bay'){
            msg.reply('I\'m afraid I can\'t let you do that.');
        }
        else{
            msg.reply('Opening '+doorType+' doors');
        }
    });

    robot.respond(/current game/i,function(msg) {
        msg.reply('current game is '+robot.brain.data.currentGame);
    });

    robot.respond(/restart game (.*)/i, function(msg) {
        var game = msg.match[1];
        clearInterval(interval);
        var finished = robot.brain.get('finishedGames') || {};
        var wasFinished = finished[game];
        delete finished[game];
        if(wasFinished){
            robot.brain.set('finishedGames',finished);
            msg.reply('Restarted game '+game);
        }
    });

    robot.respond(/start game (.*)/i, function(msg) {
        var gameId = msg.match[1];
        clearInterval(interval);
        robot.brain.data.currentGame = gameId;
        msg.reply('Current game id set to '+gameId);
        msg.reply('Please reply with turn order in the form \'JohnDoe JaneDoe MarkDankberg SteveJobs\' using hipchat mention names');
    });

    /*eslint-disable*/
    var repl = false;
    // FSM to start a game
    var fsmState = null;
    // defaults for game vars
    var gbeGameVars = {
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

    var startGbeGame = function(msg){
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
        gregcochard: 'greg@gregcochard.com',
        ryanmilbourne: 'ryan.milbourne@viasat.com',
        kevinwren: 'kevin.wren@viasat.com',
        mattmacfreier: 'matt.macfreier@viasat.com',
        jonathanbratt: 'jonathan.bratt@viasat.com'
    };

    var d12UserIds = {
        gcochard:35533,
        mmacfreier:35688,
        ryanbmilbourne:35689,
        jobratt:35690,
        kwren:35692,
        tanleach1001:37209
    };

    var d12GameTypes = {
        deathmatch:1,
        capitals:3,
        domination:5
    };

    var d12CardTypes = {
        increasing:1,
        fixed:2,
        none:3,
        capped:4
    };

    var d12States = {
        start_game: function(msg){
            repl = true;
            fsmState = 'game_type';
            msg.reply('entering interactive mode, reply "hubot cancel" to cancel game creation');
            msg.reply('Please reply with game type in the form "hubot game type <'+Object.keys(d12GameTypes).join('|')+'>"');
        },
        game_type: function(msg){
            var gameType = (msg.match[1] || '').toLowerCase();
            if(!d12GameTypes.hasOwnProperty(gameTypes)){
                msg.reply('invalid game type! Please reply with "hubot game type <type>"');
                return;
            }
            gameVars.gameType = d12GameTypes[gameType];
            var initCapGameType = gameType.split('');
            initCapGameType[0] = initCapGameType[0].toUpperCase();
            gameType = initCapGameType.join('');
            msg.reply('Set game type to '+gameType);
            fsmState = 'card_type';
            msg.reply('Please reply with card preferences in the form "hubot cards <'+Object.keys(d12CardTypes).join('|')+'>"');
        },
        card_type: function(msg){
            var cardType = (msg.match[1] || '').toLowerCase();
            if(!d12CardTypes.hasOwnProperty(cardType)){
                msg.reply('invalid card preference! Please reply with "hubot cards <preference>"');
                return;
            }
            gameVars.cardType = d12CardTypes[cardType];
            if(gameVars.cardType === 4){
                msg.reply('Set cards to capped');
                fsmState = 'card_cap';
                return msg.reply('Please reply with card cap in the form "hubot card cap <'+d12Caps.join('|')+'>"');
            }
            msg.reply('Set cards to '+cardType);
            fsmState = 'map_select';
            msg.reply('Please reply with map in the form "hubot choose map <name|id>", if you want a map preview, reply with "hubot map preview <name|id>"');
        },
        card_cap: function(msg){
            var cardCap = +(msg.match[1] || '');
            if(-1 === d12Caps.indexOf(cardCap)){
                msg.reply('Invalid card cap! Please reply with "hubot card cap <number>"');
                return;
            }
            msg.reply('Set card cap to '+cardCap);
            fsmState = 'map_select';
            msg.reply('Please reply with map in the form "hubot choose map <name|id>", if you want a map preview, reply with "hubot map preview <name|id>"');
        },
        map_select: function(msg){
        },
        player_count: function(msg){
        },
        turn_length: function(msg){
        },
        fortify_select: function(msg){
        },
        turn_order: function(msg){
        },
        dice_select: function(msg){
        },
        fog_of_war: function(msg){
        },
        teams: function(msg){
        },
        join_manner: function(msg){
        },
        colors: function(msg){
            // green for greg
        }
    };

    var gbeGameTypes = {standard:16,dark:17,blind:18,spy:19};
    var gbeStates = {
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
    /*eslint-enable*/

    /*
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
    */

    robot.respond(/(finish)|(end) game/i, function(msg) {
        robot.brain.data.currentGame = null;
        robot.brain.data.currentPlayer = null;
        clearInterval(interval);
        msg.reply('Game Over!');
    });

    robot.respond(/who['‘’]?se? turn is it/i, function(msg) {
        if(!Object.keys(robot.brain.get('currentPlayers')||{}).length){
            return msg.reply('I am not tracking any games!');
        }
        var match = msg.match[0].match(/in game (\d)+/);
        if(match && match[1]){
            checkD12(msg.send.bind(msg),+match[1],false);
        } else {
            Object.keys(robot.brain.get('currentPlayers')).forEach(function(game){
                checkD12(msg.send.bind(msg),+game,false);
            });
        }
    });

    robot.router.options('/hubot/d12log/.*',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','get, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.end();
    });

    robot.router.get('/hubot/d12log/:game',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        var game = +req.params.game;
        robot.logger.info('got request for game '+game);
        if(req.query.clearCache){
            fetchd12.clearCache();
        }
        return cachedFetchLog(game, function(err,data){
            if(err){
                robot.logger.error(err);
                robot.logger.info('got error for game '+game);
                return res.json(err);
            }
            robot.logger.info('got data for game '+game);
            return res.json(data);
        });
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

    function detectGame(ref){
        return ref.split('/').pop();
    }
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
        var game = detectGame(req.get('referrer'));
        var treaties = robot.brain.get('treaties') || {};
        treaties = _.map(treaties,function(treaty,id){
            treaty = treaty || {};
            treaty.id = id;
            return treaty;
        });
        treaties = _.filter(treaties,{game:game});
        return res.json(treaties);
    });

    function rand(min, max){
        return Math.random() * (max - min) + min;
    }

    var deathReasons = [{msg:'',weight:10},{msg:'from a stray bullet',weight:3},{msg:'due to bad life choices',weight:3},{msg:'of dysentery',weight:2},{msg:'of dissing terry',weight:1}];
    var totalWeight = deathReasons.reduce(function(prev, cur){
        return prev.weight + cur.weight;
    },0);

    function getDeathReason(){
        var random = rand(0,totalWeight);
        var weightSum = 0;
        var reason = '';

        for(var i=0, ii=deathReasons.length; i<ii; i++){
            weightSum += deathReasons[i].weight;
            if(random <= weightSum){
                reason = deathReasons[i].msg;
                break;
            }
        }
        if(reason.length > 0){
            reason = ' ' + reason;
        }
        return reason;
    }

    robot.router.options('/hubot/pushstart',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.end();
    });
    robot.router.post('/hubot/pushstart',function(req,res){
        res.header('content-type','text/plain');
        res.header('Access-Control-Allow-Origin','*');
        var response = 'date: '+ Date.now() + '\n' + 'hubot will announce start now';
        res.send(response);
        var user = req.body.user;
        var game = detectGame(req.get('referrer'));
        var currGames = robot.brain.get('currentGames') || {};
        var currMaps = robot.brain.get('currentMaps') || {};
        if(currGames[game]){
            robot.logger.info('game '+game+' already started...'+req.body.from+' is stale');
            return;
        }
        robot.logger.info('game '+game+' started thanks to '+req.body.from);
        currGames[game] = true;
        robot.brain.set('currentGames', currGames);
        var payload = '@channel: game ' + game + ' has been started by ' + user + ' join at https://dominating12.com/game/'+game;
        robot.messageRoom(gameRoom,payload);
        return getD12MapId(game, function(err, map_id){
            if(err){
                return;
            }
            currMaps[game] = map_id;
            robot.brain.set('currentMaps', currMaps);
        });
    });

    robot.router.options('/hubot/pushdeath',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.end();
    });
    robot.router.post('/hubot/pushdeath',function(req,res){
        res.header('content-type','text/plain');
        res.header('Access-Control-Allow-Origin','*');
        var response = 'date: '+ Date.now() + '\n' + 'hubot will announce deaths now';
        res.send(response);
        var payload = req.body.deaths;
        var game = detectGame(req.get('referrer'));
        var finished = robot.brain.get('finishedGames') || {};
        if(finished[game]){
            robot.logger.info('game '+game+' already over...'+req.query.from+' is stale');
            return;
        }
        robot.logger.info('announcing game '+game+' deaths');
        var currDeaths = robot.brain.get('currentDeaths') || {};
        var gameDeaths = currDeaths[game] || [];
        robot.logger.info(gameDeaths);
        if(gameDeaths.length < payload.length){
            var dead = diff(payload, gameDeaths);
            gameDeaths = payload;
            currDeaths[game] = gameDeaths;
            robot.brain.set('currentDeaths',currDeaths);
            dead.forEach(function(p){
                robot.emit('death',{ user: p, game: game});
            });
            var plural = true;
            if(dead.length === 1){
                dead = dead[0];
                plural = false;
            } else if(dead.length === 2){
                dead = dead.join(' and ');
            } else {
                dead[dead.length-1] = 'and ' + dead[dead.length-1];
                dead = dead.join(', ');
            }
            payload = '@channel: ' + dead;
            payload += ' ' +(plural?'have':'has')+ ' died'+getDeathReason() + getGameData(game);
            robot.messageRoom(gameRoom,payload);
        }
    });

    robot.router.options('/hubot/pushendturn',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.end();
    });
    robot.router.post('/hubot/pushendturn',function(req,res){
        res.header('content-type','text/plain');
        res.header('Access-Control-Allow-Origin','*');
        var response = 'date: '+ Date.now() + '\n' + 'hubot will announce player ended turn';
        res.send(response);
        var payload = req.query.user;
        var game = detectGame(req.get('referrer'));
        // if the game has ended and it's already been reported...
        var finished = robot.brain.get('finishedGames') || {};
        if(finished[game]){
            robot.logger.info('game '+game+' already over...'+req.query.from+' is stale');
            return;
        }
        robot.logger.info('announcing game '+game+' turn ended, thanks to '+req.query.from);
        payload += ' ended the turn' + getGameData(game);
        if((robot.brain.get('verbose') || {})[game]){
            robot.messageRoom(gameRoom,payload);
        }
    });

    robot.respond(/get verbose game (\d+)/i, function(msg) {
        var gameId = msg.match[1];
        var verboses = robot.brain.get('verbose') || {};
        msg.reply(verboses[gameId]);
    });

    robot.respond(/(un)?set verbose game (\d+)/i, function(msg) {
        var toggle = msg.match[1]?false:true;
        var gameId = msg.match[2];
        var verboses = robot.brain.get('verbose') || {};
        verboses[gameId] = toggle;
        robot.brain.set('verbose', verboses);
    });

    robot.router.options('/hubot/pushstartturn',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.end();
    });
    robot.router.post('/hubot/pushstartturn',function(req,res){
        res.header('content-type','text/plain');
        res.header('Access-Control-Allow-Origin','*');
        var response = 'date: '+ Date.now() + '\n' + 'hubot will announce player starting turn';
        res.send(response);
        var payload = req.query.user;
        var game = detectGame(req.get('referrer'));
        // if the game has ended and it's already been reported...
        var finished = robot.brain.get('finishedGames') || {};
        if(finished[game]){
            robot.logger.info('game '+game+' already over...'+req.query.from+' is stale');
            return;
        }
        robot.logger.info('announcing game '+game+' turn started, thanks to '+req.query.from);
        payload += ' started the turn' + getGameData(game);
        if((robot.brain.get('verbose') || {})[game]){
            robot.messageRoom(gameRoom,payload);
        }
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
        var game = detectGame(req.get('referrer'));
        // if the game has ended and it's already been reported...
        var finished = robot.brain.get('finishedGames') || {};
        if(finished[game]){
            robot.logger.info('game '+game+' already over...'+req.query.from+' is stale');
            return;
        }
        robot.logger.info('announcing game '+game+' turn, thanks to '+req.query.from);
        var currPlayers = robot.brain.get('currentPlayers') || {};
        var currMaps = robot.brain.get('currentMaps') || {};
        robot.logger.info(currPlayers);
        // if the game has ended and it hasn't been reported yet...
        function updatePayload(){
            if(req.query.ended && currPlayers[game]){
                return cleanupGame(game,req.query.user);
            } else if(currPlayers[game] !== payload){
                currPlayers[game] = payload;
                robot.brain.set('currentPlayers',currPlayers);
                if(!(/^@/.test(payload))){
                    payload = '@'+payload;
                }
                payload += ' it\'s your turn' + getGameData(game);
                return robot.messageRoom(gameRoom,payload);
            }
        }
        if(!currMaps[game]){
            return getD12MapId(game, function(err, map_id){
                if(err){
                    currMaps[game] = 1;
                } else {
                    currMaps[game] = map_id;
                }
                robot.brain.set('currentMaps', currMaps);
                return updatePayload();
            });
        }
        return updatePayload();
    });

    robot.router.options('/hubot/pushjoin',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.end();
    });
    robot.router.post('/hubot/pushjoin',function(req,res){
        res.header('content-type','text/plain');
        res.header('Access-Control-Allow-Origin','*');
        var response = 'date: '+ Date.now() + '\n' + 'hubot will announce join now';
        res.send(response);
        var payload = req.body.user;
        var game = detectGame(req.get('referrer'));
        payload += ' has joined game ' + game + ', https://dominating12.com/game/' + game;
        robot.messageRoom(gameRoom,payload);
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
        var game = detectGame(req.get('referrer'));
        var stats = robot.brain.get('stats') || {};
        stats[game] = stats[game] || [];
        stats[game].push(req.body);
        robot.emit('dice:'+game, req.body);
        robot.brain.set('stats',stats);
        response += '\n'+JSON.stringify(stats);
        res.send(response);
    });

    robot.router.options('/hubot/dice',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','OPTIONS, GET');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.end();
    });
    robot.router.get('/hubot/dice',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        var stats = robot.brain.get('stats') || {};
        if(req.query.game){
            stats = stats[req.query.game] || stats;
        }
        res.send(stats);
    });

    robot.router.options('/hubot/dicestats',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','OPTIONS, GET');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.end();
    });
    robot.router.get('/hubot/dicestats',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        var stats = robot.brain.get('stats') || {};
        if(req.query.game){
            var tmp = {};
            tmp[req.query.game] = stats[req.query.game] || stats;
            stats = tmp;
        }
        var agg = {};
        Object.keys(stats).forEach(function(game){
            stats[game].forEach(function(roll){
                var arr = [];
                arr.push(...(roll.attack || []));
                arr.push(...(roll.defend || []));
                rollset = arr.join(',');
                agg[rollset] = agg[rollset] || 0;
                agg[rollset]++;
            }));
        });

        res.send(agg);
    });

    robot.router.options('/hubot/dicestream',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','OPTIONS, GET');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.header('Content-Type', 'text/event-stream');
        res.header('Cache-Control', 'no-cache');
        res.header('Connection', 'keep-alive');
        res.end();
    });
    robot.router.get('/hubot/dicestream',function(req,res){
        res.header('Access-Control-Allow-Origin','*');
        res.header('Access-Control-Allow-Methods','OPTIONS, GET');
        res.header('Access-Control-Allow-Headers', 'x-requested-with');
        res.header('Content-Type', 'text/event-stream');
        res.header('Cache-Control', 'no-cache');
        res.header('Connection', 'keep-alive');
        res.status(200);
        var game = detectGame(req.get('referrer'));
        var messageCount = 0;
        function updater(update, type){
            messageCount++;
            type = type || 'dice';
            res.write('event: ' + type + '\n');
            res.write('id: ' + messageCount + '\n');
            res.write('data: ' + JSON.stringify(update) + '\n\n');
        }
        var channel = 'dice';
        if(game) {
            channel += ':'+game;
        }
        robot.on(channel, updater);
        res.write('\n');
        // set an interval to keep the stream alive every 5 seconds
        var intrvl = setInterval(function(){
            res.write(':keep-alive \n\n');
        }, 5000);
        req.on('close', function(){
            clearInterval(intrvl);
            if(robot.events){
                robot.events.removeListener(channel, updater);
            } else {
                robot.logger.error('could not unsubscribe');
                robot.logger.info(util.inspect(robot.events));
            }
        });
        updater('subscribed to channel: "' + channel + '"', 'handshake');

        var stats = robot.brain.get('stats') || {};
        stats[game] = stats[game] || [];
        updater(stats[game]);
    });

    robot.router.get('/hubot/checkturnscript.js',serveScript.bind(null,'checkturnscript.js'));
    robot.router.get('/hubot/checkturnscript.user.js',serveScript.bind(null,'checkturnscript.js'));
    robot.router.get('/hubot/d12.user.js',serveScript.bind(null,'d12.user.js'));
    robot.router.get('/hubot/d12.inject.user.js',serveScript.bind(null,'d12.inject.user.js'));
    robot.router.get('/hubot/dice-viz.html',serveScript.bind(null,'dice-viz.html'));

    robot.respond(/turn order( [^ ]+){2,6}/i, function(msg) {
        /*
        if(repl && fsmState === 'turn_order' && !robot.brain.data.currentGame){
            return states.turn_order(msg);
        }
        */
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
            msg.send('It\'s a magical place.');
            if(robot.brain.data.tahitis === 10) {
                msg.send('-- I keep saying that!');
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

    /*robot.respond(/yell\s+(at\s+)?(\w+)(?:\s+(\d+)\s+times)?!?/i, function(msg) {
        var user = msg.match[2];
        var count = msg.match[3] || 1;
        var rate = robot.brain.get('rateLimit') || {};

        // set the rate if it is not yet fixed for this user
        rate[msg.message.user.id] = rate[msg.message.user.id] == undefined ? baseRate : rate[msg.message.user.id];

        while(/!$/.test(user)){
            user = user.slice(0,-1);
        }
        if(!user){
            return msg.reply(matchFormat('yelling',msg));
        }
        if(/^me$/i.test(user)){
            return msg.reply(matchFormat('yelling',msg));
        }
        var currentGames = robot.brain.get('currentGames');
        if(!Object.keys(currentGames).length){
            return msg.reply(matchFormat('I am not tracking a game',msg));
        }
        var currentPlayers = robot.brain.get('currentPlayers');
        if(!_.some(currentPlayers, function(currentPlayer){
            return d12Users[currentPlayer] === user || currentPlayer === user;
        })){
            return msg.reply(matchFormat('It\'s not their turn',msg));
        }

        if(count > 10) {
            return msg.reply(matchFormat('It\'s not nice to yell that much',msg));
        }

        if(rate[msg.message.user.id] < count){
            return msg.reply(matchFormat('It\'s not nice to yell that much',msg));
        }

        rate[msg.message.user.id] -= count;

        robot.brain.set('rateLimit', rate);

        for(var c = 0; c < count; c++) {
            robot.messageRoom(gameRoom, matchFormat(formatMessage(user).message,msg));
        }
    });*/

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

    robot.respond(/debug me/i,function(msg){
        switch(++debugged){
        case 1:
            msg.reply('message.user: '+msg.message.user);
            break;
        case 2:
            msg.reply('message: '+msg.message);
            break;
        case 3:
            msg.reply('message.user.name: '+msg.message.user.name);
            break;
        case 4:
            msg.reply('message.user.id: '+msg.message.user.id);
            break;
        default:
            debugged = 0;
            break;
        }
    });
};
