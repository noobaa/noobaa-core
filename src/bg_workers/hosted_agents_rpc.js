'use strict';

var hosted_agents = require('./hosted_agents');

module.exports = {
    create_agent: hosted_agents.create_agent,
    remove_agent: hosted_agents.remove_agent,
};