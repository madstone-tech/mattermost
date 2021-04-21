# Mattermost on AWS

## Deploy Mattermost on AWS

This repo purpose is to deploy Mattermost on AWS with Cloudformation

# Initial Setup Documentation

## Requirements for Infrastucture as code

- The Mattermost application is deployed via AWS CloudFormation.
  - Each CloudFormation deployment is called a **_Stack_**
  - Each _stack_ is an independent environment with no shared resources with other environments.
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html)
  - Must be referencable as `aws` from the command line.

This documentent will describe how to setup the infrastructure needed to deploy multiple environments.

### Set up the first Infrastructure Stack

the first stack needs to be called `mattermost-pipeline`

Sets to set up the first stack

- Create the s3 bucket needed for ballista-infrastructure
- Upload the content of ballista-infrastructure repo to s3
- Create the `mattermost-pipeline`

### Create S3 bucket and Upload Content of Repo

1. open a terminal window
2. go to the root directory of this repo
3. enter the following command below `aws s3 mb s3://mattermost-pipeline-$(aws sts get-caller-identity --output text --query 'Account')` this will create the s3 bucket needed for cloudformation
4. upload the current repo to that bucket `aws s3 sync . s3://mattermost-pipeline-$(aws sts get-caller-identity --output text --query 'Account')`


### Create the first `mattermost-pipeline` stack

1. go to the `cfn-templates` folder
2. enter the following command in a terminal window

```
aws cloudformation create-stack --stack-name mattermost-pipeline --template-body file://cfn-pipeline.yml --parameters file://parameters/cli-parameter-ballistainfra.json --capabilities CAPABILITY_NAMED_IAM --tags Key=stackname,Value=ballistainfra
```

This stack will

- create 2 repos in `CodeCommit`
  - `ballista` (where the code for the app resides)
  - `ballista-infrastructure` (where the code to deploy the Continuous Delivery)
- upload the secret keys to `SSM parameter store`
  - ballista api keys
  - dw_auth_token
  - google maps api keys
  - pdi api key
  - pdi sso jwt
  - ballista store database seed Arn
  - ballista server database seed Arn

### Deploy your first environment stack

Refer to the [deploystack.md][deploystack] for instruction on how to deploy a stack.

### CICD documentation

Refer to the [cicd.md][cicd] page for CICD pipeline documentation

### CloudFormation Stacks

Refer to the [cfn-templates.md][cfn-templates] for documentation on the CloudFormation templates

### Infrastructure

Refer to the [infrastructure.md][infrastructure] page for documentation on the infrastructure design

[infrastructure]: infrastructure.md
[deploystack]: deploystack.md
[cicd]: cicd.md
[infrastructurestack]: infrastructure.md
[cfn-templates]: cfn-templates/cfn-templates.md