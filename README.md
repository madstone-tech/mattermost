# Mattermost on AWS

## What is Mattermost?
> Mattermost is an open source collaboration tool for developers

[mattermost.com][mattermostlink]

## Deploy Mattermost on AWS

This repo purpose is to deploy Mattermost on AWS with Cloudformation

### Requirements
* have an AWS account
* host a domain or sub-domain on route53 (needed to create a SSL certs with ACM)
* Admin priviledge to AWS

## Initial Setup Documentation

- The Mattermost application is deployed via AWS CloudFormation.
  - Each CloudFormation deployment is called a **_Stack_**
  - Each _stack_ is an independent environment with no shared resources with other environments.
- [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html)
  - Must be referencable as `aws` from the command line.

This document will describe how to setup the infrastructure needed to deploy multiple environments.

### Set up the first Infrastructure Stack

the first stack should to be called `mattermost-pipeline`

Sets to set up the first stack


### First update parameters
- update `cfn-templates/parameters/cli-parameters.json` file wiht the specific of your aws account.

### Create an `CloudFormationAdmin` role

- TBD
 
### Create the first `mattermost-pipeline` stack

1. go to the `cfn-templates` folder
2. enter the following command in a terminal window

```
aws cloudformation create-stack --stack-name mattermost-pipeline --template-body file://cfn-pipeline.yml --parameters file://parameters/cli-parameter.json --capabilities CAPABILITY_NAMED_IAM --tags Key=stackname,Value=mattermost-pipeline
```

This stack will

- create 1 repo in `CodeCommit`
  - `mattermost` (where the code for the app resides)
- create 2 s3 buckets
  - s3 artifact bucket for the container build
  - s3 cloudformation template
- Create an ECR repository for the container image
- IAM roles
- Deployment pipeline
- Container Build Project
- Container build pipeline
- 

### Deploy your first environment stack

Refer to the [deploystack.md][deploystack] for instruction on how to deploy a stack.

### CICD documentation

Refer to the [cicd.md][cicd] page for CICD pipeline documentation

### CloudFormation Stacks

Refer to the [cfn-templates.md][cfn-templates] for documentation on the CloudFormation templates

### Infrastructure

Refer to the [infrastructure.md][infrastructure] page for documentation on the infrastructure design

[infrastructure]: docs/infrastructure.md
[deploystack]: docs/deploystack.md
[cicd]: docs/cicd.md
[infrastructurestack]: docs/infrastructure.md
[cfn-templates]: docs/cfn-templates/cfn-templates.md
[mattermostlink]: https://mattermost.com/