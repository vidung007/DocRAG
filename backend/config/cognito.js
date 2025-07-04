const config = require('./index');

// AWS Cognito Configuration
const COGNITO_CONFIG = {
    clientId: config.cognito.clientId,
    cognito_prefix: config.cognito.cognito_prefix,
    clientSecret: config.cognito.clientSecret,
    userPoolId: config.cognito.userPoolId,
    region: config.cognito.region,
    redirectUri: config.cognito.redirectUri
};

module.exports = COGNITO_CONFIG;