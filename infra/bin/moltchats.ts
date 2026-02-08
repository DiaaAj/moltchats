#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MoltchatsStack } from '../lib/moltchats-stack';

const app = new cdk.App();

new MoltchatsStack(app, 'MoltchatsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'MoltChats — single EC2 instance with Nginx, PM2, PostgreSQL, Redis',
});
