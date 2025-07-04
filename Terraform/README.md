# Project Infrastructure Setup Guide

This guide provides step-by-step instructions for deploying the entire AWS backend infrastructure for this application using Terraform.

Due to the complex nature of the service integrations between Amazon Bedrock and Amazon OpenSearch Serverless, this setup uses a **hybrid approach**:

1.  **Terraform** creates the foundational resources (like the S3 bucket).
2.  The **AWS Console** is used to create the Knowledge Base with the "Quick create" workflow, which correctly handles the complex internal permissions.
3.  **Terraform** is then used again to create all remaining application resources (Lambda, API Gateway, etc.) that depend on the manually created knowledge base.

---

## 1. Prerequisites

Before you begin, you must have the following installed and configured:

- **Git:** To clone the project repository.
- **AWS CLI**
- **Terraform:** Version 1.0.0 or higher.

---

## 2. Initial Project Setup

1.  **Clone the Repository:**

    ```bash
    git clone <your-repository-url>
    cd <your-project-folder>
    ```

---

## 3. Infrastructure Deployment: A Two-Part Process

Follow these steps in order.

### Part 1: Create the Foundational S3 Bucket

The first step is to use Terraform's `targeting` feature to create _only_ the S3 bucket. This bucket is required for the manual Knowledge Base creation in the next step.

1.  **Navigate to the `terraform` directory** in your terminal.
2.  **Initialize Terraform.** This downloads the necessary providers.
    ```bash
    terraform init
    ```
3.  **Run a targeted apply.** This command tells Terraform to only create the S3 bucket and its direct dependencies. This command should complete successfully without errors.
    ```bash
    terraform apply -target=aws_s3_bucket.main_bucket
    ```
4.  After the command finishes, verify in the AWS S3 Console that a new bucket with a name like `testragbucket1-xxxxxx` has been created.

### Part 2: Manually Create the Bedrock Knowledge Base

Now that the S3 bucket exists, you will use the AWS Console to create the knowledge base.

1.  **Navigate to the Amazon Bedrock service** in the AWS Console, ensuring you are in your target region (e.g., `us-east-1`).
2.  In the left menu, under **Orchestration**, click **Knowledge base**.
3.  Click **Create knowledge base**.
4.  Select the **Quick create** option.
5.  Give your knowledge base a name.
6.  For the **Data source**, you must **manually type the S3 URI**. Do not use the "Browse S3" button. The URI should be `s3://<your-bucket-name>/kb-source/`, where `<your-bucket-name>` is the name of the bucket created by Terraform in the previous step.
7.  Let Bedrock automatically create a new IAM role and OpenSearch Serverless collection.
8.  Proceed through the steps and click **Create knowledge base**.

### Part 3: Manually Add S3 Permissions to the Bedrock Role

The "Quick create" wizard does not grant the new role permission to read from your S3 bucket. You must add this manually.

1.  Wait for the Knowledge Base to be created. Go to the **Data source** tab and click **Sync**. The first sync will fail.
2.  Go to the **IAM** service in the AWS Console -> **Roles**.
3.  Find the role that was just created. It will be named something like `AmazonBedrockExecutionRoleForKnowledgeBase_...`.
4.  Click on the role, go to the **Permissions** tab, and add a new **inline policy**.
5.  Use the JSON editor and paste the following policy, replacing `<your-bucket-name>` with your actual bucket name:
    ```json
    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Sid": "AllowKBSyncToReadSourceFiles",
          "Effect": "Allow",
          "Action": ["s3:GetObject"],
          "Resource": ["arn:aws:s3:::<your-bucket-name>/kb-source/*"]
        }
      ]
    }
    ```
6.  Save the policy.

### Part 4: Deploy All Remaining Infrastructure

You are now ready to let Terraform build the rest of your application's infrastructure.

1.  Go back to your terminal, ensuring you are still in the `terraform` directory.
2.  Run the standard `apply` command:
    ```bash
    terraform apply
    ```
3.  Terraform will now create all the remaining resources (Lambda functions, API Gateway, etc.) successfully.

Your backend infrastructure is now fully deployed and configured.

---

## 4. Tearing Down the Infrastructure

When you are finished, you must perform cleanup in two places.

1.  **Run `terraform destroy`.** This will remove all the resources created by Terraform.
    ```bash
    terraform destroy
    ```
2.  **Manually Delete AWS Console Resources.** Terraform will **not** delete the resources you created manually. You must go to the AWS Console and delete them yourself:
    - Go to **Bedrock** and delete the Knowledge Base.
    - Go to **Amazon OpenSearch Serverless** and delete the collection that was created for the knowledge base.
    - Go to **IAM** -> **Roles** and delete the `AmazonBedrockExecutionRoleForKnowledgeBase_...` role.
