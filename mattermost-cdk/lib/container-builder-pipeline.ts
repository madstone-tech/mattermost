import { Stack, Duration, RemovalPolicy, CfnOutput, CfnParameter, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';

export interface ContainerBuilderProps extends StackProps {
  baseNameProp: string;
  pathToDockerfile: string
}

export class ContainerBuilderStack extends Stack {
  public readonly ecrRepoUri: CfnOutput;
  public readonly ecrRepoName: CfnOutput;
  public readonly pipelineName: CfnOutput;


  constructor(scope: Construct, id: string, props: ContainerBuilderProps) {
    super(scope, id, props);

    const imageTag = new CfnParameter(this, 'imageTag', {
      type: 'String',
      description: 'Image Tag for Docker Container',
      minValue: 1,
      default: 'latest'
    })

    const branchName = new CfnParameter(this, 'BranchName', {
      type: 'String',
      description: 'CodeCommit Branch Name to Trigger Build  on CodePipeline (default: prod)',
      default: 'prod'
    })

    const containerName = new CfnParameter(this, 'ContainerName', {
      type: 'String',
      description: 'Name of container',
      default: 'mattermost-server'
    })

    // create ECR 
    const ecrRepo = new ecr.Repository(this, '_EcrRepo_', {
      lifecycleRules: [
        {
          description: 'Remove untagged Image after 2 days',
          maxImageAge: Duration.days(2),
          tagStatus: ecr.TagStatus.UNTAGGED,
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
    })

    // Create Code Commit Repository
    const codeRepo = new codecommit.Repository(this, 'CodeCommit', {
      repositoryName: props.baseNameProp + 'CodeRepo',
      description: 'codecommit repo for ' + props.baseNameProp,
    });


    // Code Build PipelineProject for Arm64

    const appCodeDockerBuildArm64 = new codebuild.PipelineProject(this, 'DockerImageBuildArm64', {
      buildSpec: codebuild.BuildSpec.fromSourceFilename('mattermost-cdk/lib/buildspec.yml'),
      checkSecretsInPlainTextEnvVariables: false,
      environmentVariables: {
        REPOSITORY_URI: {
          value: ecrRepo.repositoryUri,
        },
        IMAGE_TAG: {
          value: imageTag + '-arm64'
        },
        DOCKER_CLI_EXPERIMENTAL: {
          value: 'enabled'
        },
        PLATFORM: {
          value: 'linux/arm64'
        },
        PATH_TO_DOCKERFILE: {
          value: props.pathToDockerfile
        },
      },
      description: 'Building DockerImage for ' + props.baseNameProp + ' tag: ' + imageTag.valueAsString,
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_2_0,
        computeType: codebuild.ComputeType.LARGE,
        privileged: true,
      },
    });

    ecrRepo.grantPullPush(appCodeDockerBuildArm64);

    const appCodeDockerBuildAmd64 = new codebuild.PipelineProject(this, 'DockerImageBuildAmd64', {
      buildSpec: codebuild.BuildSpec.fromSourceFilename('mattermost-cdk/lib/buildspec.yml'),
      checkSecretsInPlainTextEnvVariables: false,
      environmentVariables: {
        REPOSITORY_URI: {
          value: ecrRepo.repositoryUri,
        },
        IMAGE_TAG: {
          value: imageTag + '-amd64'
        },
        DOCKER_CLI_EXPERIMENTAL: {
          value: 'enabled'
        },
        PLATFORM: {
          value: 'linux/amd64'
        },
        PATH_TO_DOCKERFILE: {
          value: props.pathToDockerfile
        },
      },
      description: 'Building DockerImage for ' + props.baseNameProp + 'tag: ' + imageTag.valueAsString,
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_4,
        computeType: codebuild.ComputeType.LARGE,
        privileged: true,
      },
    });

    ecrRepo.grantPullPush(appCodeDockerBuildAmd64);

    // Adjust Manifest for multiarch tag

    const appCodeDockerMultiArch = new codebuild.PipelineProject(this, 'AdjustLatestTag', {
      buildSpec: codebuild.BuildSpec.fromSourceFilename('mattermost-cdk/lib/buildspecMultiArch.yml'),
      environmentVariables: {
        REPOSITORY_URI: {
          value: ecrRepo.repositoryUri,
        },
        IMAGE_TAG: {
          value: imageTag
        },
        IMAGE_TAG_AMD64: {
          value: imageTag + '-amd64'
        },
        IMAGE_TAG_ARM64: {
          value: imageTag + '-arm64'
        },
        DOCKER_CLI_EXPERIMENTAL: {
          value: 'enabled'
        },
        CONTAINER_NAME: {
          value: containerName.valueAsString
        },
      },
      description: 'Combine Multi Architechture tag for ' + props.baseNameProp,
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_2_0,
        computeType: codebuild.ComputeType.LARGE,
        privileged: true,
      },
    });

    ecrRepo.grantPullPush(appCodeDockerMultiArch)

    const sourceOutput = new codepipeline.Artifact();

    const sourceAction = new codepipeline_actions.CodeCommitSourceAction({
      actionName: 'CodeCommit',
      repository: codeRepo,
      branch: branchName.valueAsString,
      output: sourceOutput,
    });

    const buildAmd64ImageAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuildAmd64',
      project: appCodeDockerBuildAmd64,
      input: sourceOutput,
    });

    const buildArm64ImageAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuildArm64',
      project: appCodeDockerBuildArm64,
      input: sourceOutput,
    });

    const manifestMultiArchAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'UpdateManifestMultiArch',
      project: appCodeDockerMultiArch,
      input: sourceOutput,
    });

    // Create Code Pipeline
    const builderPipeline = new codepipeline.Pipeline(this, 'BuildPipeline', {

      stages: [
        {
          stageName: 'SourceFromEcr',
          actions: [sourceAction],

        },
        {
          stageName: 'BuildAmd64',
          actions: [buildAmd64ImageAction]
        },
        {
          stageName: 'BuildArm64',
          actions: [buildArm64ImageAction]
        },
        {
          stageName: 'MultiArchManifestUpdate',
          actions: [manifestMultiArchAction]
        },
      ],
    });


    // Cfn Outputs
    this.ecrRepoUri = new CfnOutput(this, '_EcrRepoUriCfn', {
      value: ecrRepo.repositoryUri,
      description: 'Ecr repo Uri'
    })


    this.ecrRepoName = new CfnOutput(this, '_EcrRepoNameCfn', {
      value: ecrRepo.repositoryName,
      description: 'ECR Repo Name'
    })

    this.pipelineName = new CfnOutput(this, '_CodePipelineCfn', {
      value: builderPipeline.pipelineName,
      description: 'Code Pipeline Name'
    })
  }

}
