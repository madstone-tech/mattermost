import { Stack, StackProps, CfnParameter, CfnOutput, Duration, RemovalPolicy, Size, aws_codepipeline_actions } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { SslPolicy } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { readFileSync } from 'fs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';


export interface MattermostStackProps extends StackProps {
  baseNameProp: string
  numberOfInstances: number
  ecrName: string
  ecrRepoUri: string
}
export class MattermostStack extends Stack {
  constructor(scope: Construct, id: string, props: MattermostStackProps) {
    super(scope, id, props);

    const fqdn = new CfnParameter(this, 'FQDN', {
      type: 'String',
      description: 'Fully Qualified Domain Name (FQDN) for the app',
      minLength: 5,
      maxLength: 35,
      constraintDescription: 'between 5 and 45 characters',
    })

    const zoneName = new CfnParameter(this, 'ZoneName', {
      type: 'String',
      description: 'Zone Name to be used to deploy Mattermost',
      minLength: 5,
      maxLength: 35,
    })

    const zoneId = new CfnParameter(this, 'ZoneIdParameter', {
      type: 'AWS::Route53::HostedZone::Id',
      description: 'ZoneId'
    })

    const sshKeyName = new CfnParameter(this, 'SSHKeyName', {
      type: 'AWS::EC2::KeyPair::KeyName',
      description: 'EC2 Key pair name to be used in Bastion Host'
    })

    const dbName = new CfnParameter(this, 'DBNameParameter', {
      type: 'String',
      description: 'Database Name for Postgres (default: mattermostdb)',
      default: 'mattermostdb'
    })

    const imageTag = new CfnParameter(this, 'DockerImageTag', {
      type: 'String',
      description: 'Image Tag for Docker Image (default: prod)',
      default: 'prod'
    })


    const appBaseName = props.baseNameProp

    // Create Vpc with 2 Subnets 
    const vpc = new ec2.Vpc(this, 'Vpc', {
      enableDnsSupport: true,
      enableDnsHostnames: true,
      maxAzs: 2,
      natGatewayProvider: ec2.NatProvider.instance({
        instanceType: new ec2.InstanceType('t3.small'),
      }),
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
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 28,
          name: appBaseName + 'PrivateSubnet',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        }
      ]
    })


    // create Security Group for the Instance
    const bastionHostSG = new ec2.SecurityGroup(this, 'bastionhost-sg', {
      vpc,
      description: 'Security group for bastion host',
      allowAllOutbound: true,
    });

    // create Security Group for LoadBalancer
    const LoadbalancerSG = new ec2.SecurityGroup(this, 'Loadbalancer-sg', {
      vpc,
      description: 'Security group for LoadBalancer',
      allowAllOutbound: true,
    });

    LoadbalancerSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from any'
    );

    LoadbalancerSG.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from any'
    );

    // create Security Group for the Instance
    const MattermostAppSG = new ec2.SecurityGroup(this, 'mattermost-sg', {
      vpc,
      description: 'Security group for mattermost app containers',
      allowAllOutbound: true,
    });

    MattermostAppSG.connections.allowFrom(
      LoadbalancerSG,
      ec2.Port.tcp(8065),
      'Allow Websocket Traffic from LB to ECS');

    MattermostAppSG.connections.allowFrom(
      LoadbalancerSG,
      ec2.Port.tcp(80),
      'Allow HTTP Traffic from LB to ECS');

    MattermostAppSG.connections.allowFrom(
      LoadbalancerSG,
      ec2.Port.tcp(443),
      'Allow HTTPS Traffic from LB to ECS');




    // Create Role for BastionHost and attach SSM ManagedInstanceCore Policy
    const bastionHostRole = new iam.Role(this, 'bastionhost-role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // 👇 create the EC2 Instance
    const bastionHostEC2 = new ec2.Instance(this, 'ec2-instance', {
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      role: bastionHostRole,
      securityGroup: bastionHostSG,
      instanceName: 'MattermostBastionHost',
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.SMALL,
      ),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2022,
      }),
      keyName: sshKeyName.valueAsString,
      userDataCausesReplacement: true,
    });



    // 👇 add the User Data script to the Instance
    const userDataScript = readFileSync('./lib/user-data.sh', 'utf8');
    bastionHostEC2.addUserData(userDataScript);


    // Create S3 bucket for RDS exports

    const rdsS3Bucket = new s3.Bucket(this, 'S3Export', {
      removalPolicy: RemovalPolicy.DESTROY,
      publicReadAccess: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
    })


    // Creating Aurora Postgres Cluster

    const rdsCluster = new rds.DatabaseCluster(this, '_RdsCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_14_5
      }),

      instanceProps: {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE4_GRAVITON, ec2.InstanceSize.MEDIUM),
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
        vpc,
        allowMajorVersionUpgrade: true,
        autoMinorVersionUpgrade: true,
        enablePerformanceInsights: true,
        performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
        publiclyAccessible: false,
      },
      cloudwatchLogsRetention: logs.RetentionDays.ONE_WEEK,
      defaultDatabaseName: dbName.valueAsString,
      deletionProtection: true,
      iamAuthentication: true,
      instanceIdentifierBase: appBaseName,
      instances: props.numberOfInstances,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      s3ExportBuckets: [rdsS3Bucket],
      storageEncrypted: true,

    })

    const RdsSecretsArn = rdsCluster.secret?.secretArn

    const rdsClusterSecret = secrets.Secret.fromSecretAttributes(
      this,
      appBaseName + 'RdsSecrets',
      {
        secretCompleteArn: RdsSecretsArn
      }
    )

    // User Data Storage
    const userdataS3Bucket = new s3.Bucket(this, 'MattermostS3UserData', {
      accessControl: s3.BucketAccessControl.PRIVATE,
      removalPolicy: RemovalPolicy.DESTROY,
      versioned: false
    });

    const mattermostGroup = new iam.Group(this, 'mattermost-ecs-group')
    const mattermostIAMUser = new iam.User(this, 'mattermost-user', {
      groups: [mattermostGroup],
    });

    const accesskey = new iam.CfnAccessKey(this, 'CfnAccessKey', {
      userName: mattermostIAMUser.userName,
    });

    userdataS3Bucket.grantReadWrite(mattermostGroup)


    userdataS3Bucket.grantReadWrite(mattermostGroup);

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
      removalPolicy: RemovalPolicy.DESTROY,
      throughputMode: efs.ThroughputMode.PROVISIONED,
      provisionedThroughputPerSecond: Size.mebibytes(5)
    })

    const accessPointRoot = new efs.AccessPoint(this, 'EfsApRoot', {
      fileSystem: fileSystem,
      createAcl: {
        ownerGid: '0',
        ownerUid: '33',
        permissions: '0777'
      },
      path: '/mattermost'
    });

    const accessPointConfig = new efs.AccessPoint(this, 'EfsApConfig', {
      fileSystem: fileSystem,
      createAcl: {
        ownerGid: '0',
        ownerUid: '33',
        permissions: '0777'
      },
      path: '/config'
    });

    const accessPointData = new efs.AccessPoint(this, 'EfsApData', {
      fileSystem: fileSystem,
      createAcl: {
        ownerGid: '0',
        ownerUid: '33',
        permissions: '0777'
      },
      path: '/data'
    });

    const accessPointLogs = new efs.AccessPoint(this, 'EfsApLogs', {
      fileSystem: fileSystem,
      createAcl: {
        ownerGid: '0',
        ownerUid: '33',
        permissions: '0777'
      },
      path: '/logs'
    });

    const accessPointPlugins = new efs.AccessPoint(this, 'EfsApPlugins', {
      fileSystem: fileSystem,
      createAcl: {
        ownerGid: '0',
        ownerUid: '33',
        permissions: '0777'
      },
      path: '/plugins'
    })

    const accessPointClientPlugins = new efs.AccessPoint(this, 'EfsApClientPlugins', {
      fileSystem: fileSystem,
      createAcl: {
        ownerGid: '0',
        ownerUid: '33',
        permissions: '0777'
      },
      path: '/client-plugins'
    })


    // Create loadbalancer

    const loadbalancer = new elbv2.ApplicationLoadBalancer(this, 'LB', {
      vpc,
      internetFacing: true,
      securityGroup: LoadbalancerSG,
      http2Enabled: true,
      ipAddressType: elbv2.IpAddressType.DUAL_STACK,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      idleTimeout: Duration.seconds(30)
    })


    // Create ECS Cluster
    const EcsCluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
    })


    // Create TaskDefinition

    const task = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 2048,
      memoryLimitMiB: 4096,
    })


    // Add Volume to TaskDefinition

    const volumeRoot = {
      name: 'mattermost',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPointRoot.accessPointId,
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
          accessPointId: accessPointData.accessPointId,
          iam: 'ENABLED'
        },
      }
    }

    const volumeConfig = {
      name: 'mattermost-config',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPointConfig.accessPointId,
          iam: 'ENABLED'
        },
      }
    }

    const volumePlugins = {
      name: 'mattermost-plugins',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPointPlugins.accessPointId,
          iam: 'ENABLED'
        },
      }
    }

    const volumeLogs = {
      name: 'mattermost-logs',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPointPlugins.accessPointId,
          iam: 'ENABLED'
        },
      }
    }

    const volumeClientPlugins = {
      name: 'mattermost-client-plugins',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPointClientPlugins.accessPointId,
          iam: 'ENABLED'
        },
      }
    }

    task.addVolume(volumeRoot)
    task.addVolume(volumeData)
    task.addVolume(volumeConfig)
    task.addVolume(volumePlugins)
    task.addVolume(volumeClientPlugins)
    task.addVolume(volumeLogs)

    // Create Container 
    //
    const tag = imageTag.valueAsString 

    const ecrRegistry = ecr.Repository.fromRepositoryName(this, 'EcrRegistry', props.ecrName)




    const container = task.addContainer('Container', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRegistry, tag),
      memoryLimitMiB: 4096,
      containerName: 'mattermost-server',
      environment: {
        DB_HOST: rdsClusterSecret.secretValueFromJson('host').unsafeUnwrap(),
        DB_PORT_NUMBER: rdsClusterSecret.secretValueFromJson('port').unsafeUnwrap(),
        MM_DBNAME: rdsClusterSecret.secretValueFromJson('dbname').unsafeUnwrap(),
        MM_USERNAME: rdsClusterSecret.secretValueFromJson('username').unsafeUnwrap(),
        MM_PASSWORD: rdsClusterSecret.secretValueFromJson('password').unsafeUnwrap(),
      },
      essential: true,
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'nextcloud',
        logRetention: logs.RetentionDays.TWO_WEEKS,
        mode: ecs.AwsLogDriverMode.NON_BLOCKING,
      }),
      portMappings: [
        {
          containerPort: 8065,
          hostPort: 8065
        }
      ]
    })
    container.addMountPoints({
      containerPath: '/mattermost/config',
      sourceVolume: volumeConfig.name,
      readOnly: false
    })

    container.addMountPoints({
      containerPath: '/mattermost/data',
      sourceVolume: volumeData.name,
      readOnly: false
    })

    container.addMountPoints({
      containerPath: '/mattermost/logs',
      sourceVolume: volumeLogs.name,
      readOnly: false
    })

    container.addMountPoints({
      containerPath: '/mattermost/plugins',
      sourceVolume: volumePlugins.name,
      readOnly: false
    })

    container.addMountPoints({
      containerPath: '/mattermost/client/plugins',
      sourceVolume: volumeClientPlugins.name,
      readOnly: false
    })



    task.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'elasticfilesystem:*',
        ],
        resources: [fileSystem.fileSystemArn, accessPointRoot.accessPointArn, accessPointConfig.accessPointArn, accessPointData.accessPointArn, accessPointPlugins.accessPointArn, accessPointClientPlugins.accessPointArn, accessPointLogs.accessPointArn]
      })
    )
    bastionHostRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'elasticfilesystem:*',
        ],
        resources: [fileSystem.fileSystemArn, accessPointRoot.accessPointArn, accessPointConfig.accessPointArn, accessPointData.accessPointArn, accessPointPlugins.accessPointArn, accessPointClientPlugins.accessPointArn, accessPointLogs.accessPointArn]
      })
    )

    // create Certificate

    const domainZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      zoneName: zoneName.valueAsString,
      hostedZoneId: zoneId.valueAsString
    })


    const certificate = new acm.Certificate(this, 'Cert', {
      domainName: fqdn.valueAsString,
      validation: acm.CertificateValidation.fromDns(domainZone)
    })


    // Create Mattermost Service

    const capacityProviderStrategy: ecs.CapacityProviderStrategy = {
      capacityProvider: 'FARGATE_SPOT',
      base: 1,
      weight: 1
    };


    const MattermostEcsService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster: EcsCluster,
      capacityProviderStrategies: [capacityProviderStrategy],
      desiredCount: 1,
      domainName: fqdn.valueAsString,
      domainZone: domainZone,
      certificate: certificate,
      redirectHTTP: true,
      sslPolicy: SslPolicy.RECOMMENDED_TLS,
      publicLoadBalancer: true,
      healthCheckGracePeriod: Duration.seconds(300),
      memoryLimitMiB: 4096,
      cpu: 2048,
      loadBalancer: loadbalancer,
      assignPublicIp: false,
      securityGroups: [MattermostAppSG],
      taskDefinition: task,
      taskSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    })

    MattermostEcsService.targetGroup.configureHealthCheck({
      path: '/api/v4/system/ping',
      healthyHttpCodes: '200-299',
      healthyThresholdCount: 2,
      interval: Duration.seconds(30),
      port: '8065',
      protocol: elbv2.Protocol.HTTP,
      timeout: Duration.seconds(10),
      unhealthyThresholdCount: 2
    })

    fileSystem.connections.allowDefaultPortFrom(MattermostAppSG, 'Allow EFS Traffic from Ecs Cluster')
    fileSystem.connections.allowDefaultPortFrom(bastionHostSG, 'Allow EFS Traffic from BastionHost')


    // Create Pipeline to deploy updates on new Container Updates
    // create empty codepipeline
    const pipeline = new codepipeline.Pipeline(this, 'DeployPipeline');

    // pipeline soureOutput Artifact
    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();
    const sourceAction = new aws_codepipeline_actions.EcrSourceAction({
      actionName: 'UpdateContainerImage',
      repository: ecrRegistry,
      imageTag: tag,
      output: sourceOutput
    })

    const updateArtifactBuildProject = new codebuild.PipelineProject(this, 'UpdateArtifact', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'echo install jq', 'dnf install jq -y'
            ],
          },
          pre_build: {
            commands: [
              'echo Artifact pre adjustment', 'cat imageDetail.json'
            ]
          },
          build: {
            commands: [
              'cat imageDetail.json | jq \'\[\{ \"name\":\"mattermost-server\",\"imageUri\"\:\.ImageURI\}\]\' > imagedefinition.json'
            ]
          },
          post_build: {
            commands: [
              'echo Artifact post adjustment', 'cat imagedefinition.json'
            ]
          },
        },
        artifacts: {
          files: [
            'imagedefinition.json'
          ]
        }
      }),
      description: 'Update Container Image Artifact for ECS service Update',
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_2_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
      },
    })

    const updateArtifactAction = new aws_codepipeline_actions.CodeBuildAction({
      actionName: props.baseNameProp + 'UpdateArtifact',
      project: updateArtifactBuildProject,
      input: sourceOutput,
      outputs: [buildOutput],
    });

    // Deploy Stage

    const deployEcsStageAction = new aws_codepipeline_actions.EcsDeployAction({
      actionName: props.baseNameProp + 'DeployEcs',
      service: MattermostEcsService.service,
      imageFile: buildOutput.atPath('imagedefinition.json'),
      deploymentTimeout: Duration.minutes(60),
    })

    // put pipeline role into a construct
    const pipelineRole = pipeline.role;
    ecrRegistry.grantPull(pipelineRole);

    // pipeline stages
    pipeline.addStage(
      {
        stageName: 'Source',
        actions: [sourceAction],
      }
    );

    pipeline.addStage(
      {
        stageName: 'UpdateArtifact',
        actions: [updateArtifactAction],
      }
    );

    pipeline.addStage(
      {
        stageName: 'DeployEcs',
        actions: [deployEcsStageAction]
      }
    );

    // Outputs

    new CfnOutput(this, 'VpcId', {
      description: 'VpcId',
      value: vpc.vpcId
    })

    new ssm.StringParameter(this, 'SSMVpcId', {
      parameterName: '/' + appBaseName + '/VpcId',
      stringValue: vpc.vpcId,
      description: 'VpvId for ' + appBaseName
    })

    new CfnOutput(this, 'EfsId', {
      description: 'EFSId',
      value: fileSystem.fileSystemId
    })

    new ssm.StringParameter(this, 'SSMEfsId', {
      parameterName: '/' + appBaseName + '/EFSId',
      stringValue: fileSystem.fileSystemId
    })

    new CfnOutput(this, 'Url', {
      description: 'URL',
      value: 'https://' + fqdn.valueAsString
    })

    new CfnOutput(this, 'S3BucketName', {
      description: 'S3 Bucket Name',
      value: userdataS3Bucket.bucketName
    })
    new ssm.StringParameter(this, 'SSMS3Bucker', {
      parameterName: '/' + appBaseName + '/S3BucketName',
      stringValue: userdataS3Bucket.bucketName,
      description: 'S3 BucketName for ' + appBaseName
    })

    new CfnOutput(this, 'RDSCredentials', {
      description: 'RDS Cluster Secret Credential Name',
      value: rdsClusterSecret.secretName
    })


  }
}
