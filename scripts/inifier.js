// Description:
//   replace in with :in:

/*eslint-env node*/
'use strict';

var _ = require('lodash');
var util = require('util');

module.exports = function(robot){
    robot.hear(/.*[^:]in[^:].*/, function(msg){
        return msg.reply(`did you mean ${msg.match[0].replace(/([^:])in([^:])/g, '$1:in:$2')}?`);
    });
};