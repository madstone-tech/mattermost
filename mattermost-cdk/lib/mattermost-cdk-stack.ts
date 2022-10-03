import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { CodeBuildAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as logs from 'aws-cdk-lib/aws-logs';
// import { TaskDefinition, Cluster } from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { SslPolicy } from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export interface MattermostCommonStackProps extends cdk.StackProps {
  baseNameProp: string
  envNameProp: string
  fqdnProp: string
  zoneNameProp: string
  hostedZoneIdProp: string
  containerImageTag: string
}
export class MattermostCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MattermostCommonStackProps) {
    super(scope, id, props);

    const appBaseName = props.baseNameProp

    // Create Vpc with 2 subnets

    const vpc = new ec2.Vpc(this, 'Vpc', {
      enableDnsSupport: true,
      enableDnsHostnames: true,
      maxAzs: 2,
      natGatewayProvider: ec2.NatProvider.instance({ instanceType: new ec2.InstanceType('t3.small') }),
      natGateways: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: appBaseName + 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: appBaseName + 'AppSubnet',
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        },
        {
          cidrMask: 28,
          name: appBaseName + 'PrivateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }
      ]
    })
    // Create ECR Repo 
    const ecrRepo = new ecr.Repository(this, appBaseName + 'EcrRepo', {
      lifecycleRules: [
        {
          description: 'Remove untagged Image after 2 days',
          maxImageAge: cdk.Duration.days(2),
          tagStatus: ecr.TagStatus.UNTAGGED,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a Code Commit Repository
    const codeRepo = new codecommit.Repository(this, appBaseName + 'CodeCommit', {
      repositoryName: appBaseName + 'CodeRepo',
      description: 'codecommit repo for ' + appBaseName,
    });


    // Create RDS cluster for database

    const RdsCluster = new rds.ServerlessCluster(this, 'Rds', {
      engine: rds.DatabaseClusterEngine.AURORA_POSTGRESQL,
      backupRetention: cdk.Duration.days(7),
      defaultDatabaseName: 'mattermostdb',
      deletionProtection: true,
      scaling: {
        autoPause: cdk.Duration.minutes(10),
        minCapacity: rds.AuroraCapacityUnit.ACU_2,
        maxCapacity: rds.AuroraCapacityUnit.ACU_4,
      },
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      enableDataApi: false,
    })

    const RdsSecretsArn = RdsCluster.secret?.secretArn

    const rdsClusterSecret = secrets.Secret.fromSecretAttributes(this, appBaseName + 'RdsSecrets', {
      secretCompleteArn: RdsSecretsArn
    })
    // create EFS 
    const fileSystem = new efs.FileSystem(this, 'Efs', {
      vpc: vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      enableAutomaticBackups: true,
      encrypted: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      outOfInfrequentAccessPolicy: efs.OutOfInfrequentAccessPolicy.AFTER_1_ACCESS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const accessPoint = new efs.AccessPoint(this, 'EfsAp', {
      fileSystem: fileSystem,
    })

    const EcsSG = new ec2.SecurityGroup(this, 'MattermostSG', {
      vpc,
      allowAllOutbound: true,
    })

    const loadBalancerSG = new ec2.SecurityGroup(this, appBaseName + 'LB', {
      vpc,
      allowAllOutbound: true,
    })

    loadBalancerSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(433),
      "Allow all incoming HTTPS traffic"
    );

    loadBalancerSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow all incoming HTTP traffic"
    );

    EcsSG.connections.allowFrom(loadBalancerSG, ec2.Port.tcp(8000))
    // Create loadbalancer

    const loadbalancer = new elbv2.ApplicationLoadBalancer(this, 'LB', {
      vpc,
      internetFacing: true,
      securityGroup: loadBalancerSG,
      http2Enabled: true,
      ipAddressType: elbv2.IpAddressType.IPV4,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    })

    // Create ECS Cluster
    const EcsCluster = new ecs.Cluster(this, appBaseName + 'EcsCluster', {
      vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
    })

    // Create TaskDefinition

    const task = new ecs.FargateTaskDefinition(this, appBaseName + 'TaskDef', {
      cpu: 2048,
      memoryLimitMiB: 4096,
    })

    // Add Volume to TaskDefinition

    const volumeConfig = {
      name: 'mattermost-config',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED'
        },
      }
    }
    const volumeData = {
      name: 'mattermost-data',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED'
        }
      }
    }
    const volumeLog = {
      name: 'mattermost-log',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED'
        }
      }
    }

    const volumePlugins = {
      name: 'mattermost-plugins',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED'
        }
      }
    }

    task.addVolume(volumeConfig)
    task.addVolume(volumeLog)
    task.addVolume(volumeData)
    task.addVolume(volumePlugins)

    // create Container 
    const tag = props.containerImageTag

    const container = task.addContainer('MattermostContainer', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, tag),
      memoryLimitMiB: 4096,
      containerName: 'mattermost-app',
      environment: {
        MM_USERNAME: rdsClusterSecret.secretValueFromJson('username').toString(),
        MM_PASSWORD: rdsClusterSecret.secretValueFromJson('password').toString(),
        MM_DBNAME: rdsClusterSecret.secretValueFromJson('dbname').toString(),
        DB_HOST: rdsClusterSecret.secretValueFromJson('host').toString(),
        DB_PORT_NUMBER: rdsClusterSecret.secretValueFromJson('port').toString(),
      },
      essential: true,
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'mattermost-cdk',
        logRetention: logs.RetentionDays.TWO_WEEKS,
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      portMappings: [
        {
          containerPort: 8000,
          hostPort: 8000
        }
      ]

    })

  }
}
