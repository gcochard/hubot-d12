// Description:
//   keeper of games treaties
//
// Dependencies:
//   lodash
//   shortid
//
// Commands:
//   hubot treaty me <game> <terms> <partner> - Proposes a treaty of <terms> between the requestor and <partner> in <game>
//   hubot treaty list - Lists the current treaties in place
//   hubot treaty add <id> <partner> - Invite a new partner to the treaty. You must be a member of the treaty.
//   hubot ratify me <id> - Agree to join treaty belonging to the ID
//   hubot decline me <id> - Decline to join the treaty belonging to the ID
//   hubot untreaty me <id> - Dissolves treaty belonging to the ID

/*eslint-env node*/
'use strict';

var _ = require('lodash');
var shortid = require('shortid');
var util = require('util');
var gameRoom = '#games';
var players = [
                'mmacfreier',
                'kwren',
                'greg',
                'justin',
                'ryan',
                'jobratt',
                'suntan'
];

module.exports = function(robot){
    /**
     * Builds a formatted string listing the current treaties
     */
    var formatTreaties = function(incPending,cb){
        var treaties = _.groupBy(robot.brain.get('treaties') || {}, 'game');
        if(!Object.keys(treaties).length){
            return cb(new Error('No active treaties'));
        }

        var outputString = '```\n';
        var output = _.map(treaties, function(val,key){
            var first = true;
            var outputString = 'Game '+key+': \n';
            var outputString2 = _.map(val, function(val){
                var outputString3 = '';
                if(val.partners.length < 2 && !incPending){
                    return;
                }
                var partnerString = '';
                _.each(val.partners, function(name){
                    partnerString+=(name+' ');
                });
                var pendingString = '';
                _.each(val.pending, function(name){
                    pendingString+=(name+' ');
                });
                if(first){
                    outputString3 += '===========================\n';
                    first = false;
                }
                outputString3 += 'Treaty ID: '+val.id+ '\n';
                outputString3 += 'Participating Parties: '+partnerString+'\n';
                if(incPending){
                    outputString3 += 'Pending Parties: '+pendingString+'\n';
                }
                outputString3 += 'Treaty Terms: '+val.terms+'\n===========================\n'; 
                robot.logger.log('intermediate string: %s',outputString3);
                return outputString3;
            }).join('');
            robot.logger.log('intermediate string: %s',outputString2);
            if(outputString2){
                return outputString + outputString2;
            }
            return '';
        });
        robot.logger.log('intermediate string: %s',output);
        if(!output.join('').length){
            return cb(new Error('No active treaties'));
        }
        outputString += output.join('');
        outputString += '```';
        return cb(null, outputString);
    };

    robot.respond(/treaty lisz?t( pending)/i, function(msg){
        robot.logger.log('heard treaty list');
        formatTreaties(msg.match.length>1,function(err, treaties){
            if(err){
                return msg.send(err);
            }
            return msg.send(treaties + (/z/.test(msg.match[0])?'Liszt is my favorite composer, by the way!':''));
        });
    });

    var partnerStates = {
        propose: function(potentialPartner, treatyId, cb){
            if(!_.contains(players, potentialPartner)){
                return cb(potentialPartner+' is not one of my players!');
            }
            robot.logger.log('Fetching treaties...');
            var treaties = robot.brain.get('treaties') || {};
            robot.logger.log('treaties: %j',treaties);
            if(!treaties[treatyId]){
                return cb('I couldn\'t find that treaty!');
            }
            if(_.contains(treaties[treatyId].partners, potentialPartner)){
                return cb(potentialPartner+' is already party to that treaty!');
            }
            treaties[treatyId].pending = treaties[treatyId].pending || [];
            if(_.contains(treaties[treatyId].pending, potentialPartner)){
                return cb(potentialPartner+' was already invited!');
            }
            treaties[treatyId].pending.push(potentialPartner);
            robot.brain.set('treaties', treaties);
            return cb(null);
        },
        ratify: function(msg){
            var id = msg.match[1]
              , sender = robot.brain.userForId(msg.envelope.user.id).name
              , treaties = robot.brain.get('treaties')
              ;

            if(!_.contains(players, sender)){
                return msg.reply('You\'re not one of my players!');
            }
            if(!treaties[id]){
                return msg.reply('I couldn\'t find that treaty!');
            }
            if(_.contains(treaties[id].partners, sender)){
                return msg.reply('You are already a party to that treaty!');
            }
            if(!_.contains(treaties[id].pending, sender)){
                return msg.reply('This is awkward...but you were\'t invited to that treaty.');
            }

            treaties[id].pending = _.without(treaties[id].pending, sender);
            treaties[id].partners.push(sender);
            robot.brain.set('treaties', treaties);

            if(treaties[id].partners.length === 2){
                return msg.send('@channel The Treaty of '+id+' has been ratified by two parties and is now in effect for those parties.');
            } else if (treaties[id].partners.length > 2){ 
                return msg.send('@channel @'+sender+' is now party to the Treaty of '+id+' and all the agreements stated or implied therein.');
            }
        },
        decline: function(msg){
            var id = msg.match[1]
              , sender = robot.brain.userForId(msg.envelope.user.id).name
              , treaties = robot.brain.get('treaties')
              ;

            if(!_.contains(players, sender)){
                return msg.reply('You\'re not one of my players!');
            }
            if(!treaties[id]){
                return msg.reply('I couldn\'t find that treaty!');
            }
            if(!_.contains(treaties[id].pending, sender)){
                return msg.reply('This is awkward...but you were\'t invited to that treaty.');
            }

            treaties[id].pending = _.without(treaties[id].pending, sender);
            msg.send('@channel @'+sender+' declined to join the Treaty of '+id);
            
            if(!treaties[id].pending.length && treaties[id].partners.length === 1){
                msg.send('@'+treaties[id].partners[0]+' Nobody wanted to join your treaty.');
                delete treaties[id];
            }
            robot.brain.set('treaties', treaties);
        }
    };

    robot.respond(/ratify me ([a-zA-Z_\-0-9]+)/i, partnerStates.ratify);
    robot.respond(/decline me ([a-zA-Z_\-0-9]+)/i, partnerStates.decline);

    robot.respond(/split me "(.*)"( [^ ]+){2,6}/i, function(msg){
        var order = msg.match[0].replace(/^.*split me "(.*)"/,'').split(' ');
        _.each(order, function(name){
            msg.send(name);
        });
    });

    robot.respond(/treaty me (\d+) "(.*)"( [^ ]+){1,5}/i, function(msg){
        robot.logger.log('heard treaty me, message: %j',util.inspect(msg));
        robot.logger.log('heard treaty me, envelope: %j',util.inspect(msg.envelope));
        robot.logger.log('heard treaty me, user:  %j',util.inspect(msg.envelope.user));
        robot.logger.log('heard treaty me, id %j',util.inspect(msg.envelope.user.id));
        robot.logger.log('heard treaty me, userForId %j',util.inspect(robot.brain.userForId(msg.envelope.user.id)));
        robot.logger.log('heard treaty me, userForId.name %j',util.inspect(robot.brain.userForId(msg.envelope.user.id).name));
        var game = msg.match[1]
          , terms = msg.match[2]
          , requestor = robot.brain.userForId(msg.envelope.user.id).name
          ;

        robot.logger.info('Game %d, terms: %s, partners: %j', game, terms, msg.match.slice(2));
        if(!_.contains(players, requestor)){
            msg.reply('I can\'t do that. You\'re not one of my players!'); 
            return msg.reply('You are '+requestor+' and my players are '+players.join(', ')); 
        }

        var id = shortid.generate();
        var treaties = robot.brain.get('treaties') || {};

        robot.logger.info('id: %s', id);

        treaties[id] = {
            partners: [requestor],
            pending: [],
            game: game,
            terms: terms
        };
        robot.brain.set('treaties', treaties);

        var partners = msg.match[0].replace(/^.*treaty me \d+ "(.*)"/,'').split(' ');
        partners = partners.map(function(s){
            if(s.indexOf('@') === 0){
                return s.slice(1);
            }
            return s;
        });
        partners = _.without(partners, '');

        robot.logger.info('partners: %s', partners.join(', '));

        _.each(partners, function(partner){
            robot.logger.info('proposing: %s', partner);
            partnerStates.propose(partner, id, function(err){
                robot.logger.info('err? %j', err);
                if(err){
                    return msg.reply(err);
                }
                msg.send('@'+partner+' You have been invited to join the Treaty of '+id+'.\nRatify or Decline (`'+robot.name+' (ratify|decline) me '+id+'`)');
            });
        });
        return msg.reply('Your treaty proposal is noted and the parties have been invited.');
    });

    //robot.respond(/treaty me @?([a-zA-Z]+) (.*)/i, function(msg){
    //    var terms = msg.match[2]
    //      , partner = msg.match[1]
    //      , requestor = robot.brain.userForId(msg.envelope.user.id).mention_name
    //      ;

    //    if(!_.contains(players, requestor)){
    //        return msg.reply('I can\'t do that.  You\'re not one of my players!'); 
    //    }
    //    if(!_.contains(players, partner)){
    //        return msg.reply('I can\'t do that.  I don\'t know '+partner); 
    //    }
    //    if(requestor === partner){
    //        return msg.reply('You cannot draft a treaty with yourself!');
    //    }

    //    var id = shortid.generate();
    //    var treaties = robot.brain.get('treaties') || {};

    //    treaties[id] = {
    //        partners: [requestor, partner],
    //        pending: [],
    //        terms: terms
    //    };
    //    robot.brain.set('treaties', treaties);

    //    return msg.reply(' and @'+partner+': Your agreement is recorded & recognized \'round the world as the Treaty of '+id);
    //});

    robot.respond(/treaty add ([a-zA-Z_\-0-9]+) [@]+([a-zA-Z]+)/i, function(msg){
        var id = msg.match[1]
          , player = msg.match[2]
          , requestor = robot.brain.userForId(msg.envelope.user.id).name
          , treaties = robot.brain.get('treaties')
          ;


        if(!_.contains(players, requestor)){
            return msg.reply('I can\'t do that.  You\'re not one of my players!'); 
        }
        if(!_.contains(players, player)){
            return msg.reply('I can\'t do that.  I don\'t know '+player+'.'); 
        }

        if(!treaties[id]){
            return msg.reply('I couldnt find that treaty!');
        }

        if(!_.contains(treaties[id].partners, requestor)){
            return msg.reply('You\'re not a member of that treaty!');
        }

        partnerStates.propose(player, id, function(err){
            if(err){
                return msg.reply(err);
            }
            msg.send('@'+player+' You have been invited to join the Treaty of '+id+'.\nRatify or Decline (`hubot (ratify|decline) me '+id+'`)');
            return msg.reply('Invite sent.');
        });

        //msg.send('@'+player+' do you agree to join the Treaty of '+id+'? (Yes/No)');
        //robot.respond(/([a-zA-Z_\-0-9]+) ((Yes)|(No))/i, function(responseMsg){
        //    var replyId = msg.match[1];
        //    var replyAnswer = msg.match[2];
        //    var responder = robot.brain.userForId(responseMsg.envelope.user.id).mention_name

        //    if(responder === player && replyId === id){
        //        if(replyAnswer.toUpperCase() === 'YES'){
        //            treaties[id].partners.push(player);
        //            robot.brain.set('treaties', treaties);
        //            return msg.send('@all @'+player+' is now party to the Treaty of '+id+' and all the agreements stated or implied therein.');
        //        }
        //        return msg.send('@all @'+player+' declined to join the Treaty of '+id);
        //    }
        //});
    });

    robot.respond(/untreaty( me)? ([a-zA-Z_\-0-9]+)/i, function(msg){
        var id = msg.match[2];
        var requestor = robot.brain.userForId(msg.envelope.user.id).name;
        var treaties = robot.brain.get('treaties');

        if(!treaties || !treaties[id]){
            return msg.reply('I couldnt find that treaty!');
        }
        if(!_.contains(treaties[id].partners, requestor)){
            return msg.reply('You\'re not party to that treaty. Tsk Tsk.');
        }

        delete treaties[id];
        robot.brain.set('treaties', treaties);
        return msg.reply('@channel Treaty '+id+' has been dissolved!');
    });

};
