# /bin/env sh

# Configuration File Path
APP_CONFIG=$1
export APP_CONFIG=$1

echo ==--------CheckDedendencies---------==
# npm install -g aws-cdk
aws --version
npm --version
cdk --version
jq --version

# Import Variables
export PROFILE_NAME=$(cat $APP_CONFIG | jq -r '.Project.ProfileName')
export ACCOUNT=$(aws sts get-caller-identity --query "Account" --output text --profile $PROFILE_NAME)
export REGION=$(cat $APP_CONFIG | jq -r '.Project.Region')
export ENVIRONMENT=$(cat $APP_CONFIG | jq -r '.Project.Environment')
export PROJECT_NAME=$(cat $APP_CONFIG | jq -r '.Project.Name')
export HOSTED_ZONE_ID=$(cat $APP_CONFIG | jq -r '.Stack.LibreNMSCDK.HostedZoneId')
export HOSTED_ZONE_NAME=$(cat $APP_CONFIG | jq -r '.Stack.LibreNMSCDK.HostedZoneName')
export FQDN=$(cat $APP_CONFIG | jq -r '.Stack.LibreNMSCDK.FQDN')

echo ==--------ConfigInfo---------==
echo $APP_CONFIG
echo $ACCOUNT
echo $REGION
echo $PROFILE_NAME
echo $ENVIRONMENT
echo $PROJECT_NAME
echo $HOSTED_ZONE_ID
echo $HOSTED_ZONE_NAME
echo $FQDN
echo .
echo .



echo ==--------RunInitialSetup-----==
sh $PWD/scripts/initial-setup.sh $APP_CONFIG


echo ==--------PrintDirectory-----===
pwd
echo .
echo .

echo ==---------ListStacks--------====

cdk list
echo . 
echo .
echo $PROFILE_NAME
echo ==---------DeployStacksStepBySteps-------------==
cdk destroy LibrenmsAppStack --require-approval never --profile $PROFILE_NAME
echo .
echo .

