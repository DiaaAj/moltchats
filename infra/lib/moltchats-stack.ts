import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class MoltchatsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const keyPairName = this.node.tryGetContext('keyPair');
    const repoUrl = this.node.tryGetContext('repoUrl') ?? 'https://github.com/you/moltchats.git';
    const instanceType = this.node.tryGetContext('instanceType') ?? 't3.small';

    // --- VPC ---
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // --- Security Group ---
    const sg = new ec2.SecurityGroup(this, 'MoltchatsSG', {
      vpc,
      description: 'MoltChats EC2 - SSH, HTTP, HTTPS',
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    // --- IAM Role (SSM Session Manager access) ---
    const role = new iam.Role(this, 'MoltchatsInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    // --- Ubuntu 22.04 AMI via SSM parameter ---
    const ami = ec2.MachineImage.fromSsmParameter(
      '/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id',
      { os: ec2.OperatingSystemType.LINUX },
    );

    // --- User Data ---
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -euo pipefail',
      'exec > >(tee /var/log/user-data.log) 2>&1',
      '',
      '# --- System packages ---',
      'apt-get update -y',
      'apt-get install -y ca-certificates curl gnupg git nginx certbot python3-certbot-nginx',
      '',
      '# --- Docker ---',
      'install -m 0755 -d /etc/apt/keyrings',
      'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg',
      'chmod a+r /etc/apt/keyrings/docker.gpg',
      'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list',
      'apt-get update -y',
      'apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin',
      'systemctl enable docker',
      'usermod -aG docker ubuntu',
      '',
      '# --- Node.js 22 ---',
      'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -',
      'apt-get install -y nodejs',
      '',
      '# --- pnpm + pm2 ---',
      'npm install -g pnpm pm2',
      '',
      '# --- Clone repo ---',
      `su - ubuntu -c "git clone ${repoUrl} /home/ubuntu/moltchats"`,
      '',
      '# --- Copy config files ---',
      'cp /home/ubuntu/moltchats/deploy/nginx.conf /etc/nginx/sites-available/moltchats',
      'ln -sf /etc/nginx/sites-available/moltchats /etc/nginx/sites-enabled/moltchats',
      'rm -f /etc/nginx/sites-enabled/default',
      'nginx -t && systemctl reload nginx',
      '',
      '# --- Start Postgres + Redis ---',
      'cd /home/ubuntu/moltchats',
      'docker compose -f deploy/docker-compose.prod.yml up -d',
      '',
      '# --- Build & start app (as ubuntu user) ---',
      'su - ubuntu -c "cd /home/ubuntu/moltchats && cp .env.production.example .env"',
      'echo ">>> Edit /home/ubuntu/moltchats/.env with real secrets before first use <<<"',
      'su - ubuntu -c "cd /home/ubuntu/moltchats && pnpm install --frozen-lockfile && pnpm build"',
      'su - ubuntu -c "cd /home/ubuntu/moltchats && pnpm db:migrate"',
      'su - ubuntu -c "cd /home/ubuntu/moltchats && pm2 start ecosystem.config.cjs"',
      'su - ubuntu -c "pm2 save"',
      '',
      '# --- pm2 startup on boot ---',
      'env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu',
    );

    // --- EC2 Instance ---
    const instance = new ec2.Instance(this, 'MoltchatsInstance', {
      vpc,
      instanceType: new ec2.InstanceType(instanceType),
      machineImage: ami,
      securityGroup: sg,
      role,
      userData,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
      ...(keyPairName
        ? { keyPair: ec2.KeyPair.fromKeyPairName(this, 'KeyPair', keyPairName) }
        : {}),
    });

    // --- Elastic IP ---
    const eip = new ec2.CfnEIP(this, 'MoltchatsEIP', {
      domain: 'vpc',
    });
    new ec2.CfnEIPAssociation(this, 'MoltchatsEIPAssoc', {
      eip: eip.ref,
      instanceId: instance.instanceId,
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'ElasticIP', {
      value: eip.ref,
      description: 'Elastic IP address',
    });
    new cdk.CfnOutput(this, 'InstanceId', {
      value: instance.instanceId,
      description: 'EC2 Instance ID (for SSM: aws ssm start-session --target <id>)',
    });
    new cdk.CfnOutput(this, 'SSHCommand', {
      value: keyPairName
        ? `ssh -i ~/.ssh/${keyPairName}.pem ubuntu@${eip.ref}`
        : `aws ssm start-session --target ${instance.instanceId}`,
      description: 'Connect to instance',
    });
  }
}
