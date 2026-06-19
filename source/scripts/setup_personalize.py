"""
Set up Amazon Personalize: import data, create solution, and create campaign.

This script:
1. Creates dataset import jobs for items, users, and interactions
2. Waits for imports to complete
3. Creates a solution (model training — takes 1-2 hours)
4. Creates a campaign (inference endpoint)

Usage:
    python scripts/setup_personalize.py --region us-east-1
"""

import argparse
import json
import time

import boto3


def get_stack_outputs(stack_name: str, region: str) -> dict:
    cf = boto3.client("cloudformation", region_name=region)
    response = cf.describe_stacks(StackName=stack_name)
    outputs = response["Stacks"][0]["Outputs"]
    return {o["OutputKey"]: o["OutputValue"] for o in outputs}


def wait_for_import_jobs(personalize, job_arns: list[str]):
    """Wait for all import jobs to complete."""
    print("  Waiting for import jobs to complete...")
    while True:
        all_done = True
        for arn in job_arns:
            response = personalize.describe_dataset_import_job(datasetImportJobArn=arn)
            status = response["datasetImportJob"]["status"]
            if status == "ACTIVE":
                continue
            elif status in ("CREATE FAILED",):
                raise Exception(f"Import job failed: {arn} — {response['datasetImportJob'].get('failureReason')}")
            else:
                all_done = False
        if all_done:
            break
        time.sleep(30)
        print("    Still importing...")
    print("  ✓ All imports complete")


def main():
    parser = argparse.ArgumentParser(description="Set up Amazon Personalize")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--stack-name", default="retail-personalization-on-aws")
    parser.add_argument("--skip-import", action="store_true", help="Skip data import (if already done)")
    parser.add_argument("--skip-training", action="store_true", help="Skip solution training (if already done)")
    args = parser.parse_args()

    personalize = boto3.client("personalize", region_name=args.region)

    # Get stack outputs
    print("Fetching stack outputs...")
    outputs = get_stack_outputs(args.stack_name, args.region)

    dataset_group_arn = next(v for k, v in outputs.items() if "DatasetGroupArn" in k)
    role_arn = next(v for k, v in outputs.items() if "PersonalizeRoleArn" in k)
    bucket_name = next(v for k, v in outputs.items() if "PersonalizeBucketName" in k)

    print(f"  Dataset Group: {dataset_group_arn}")
    print(f"  Role: {role_arn}")
    print(f"  Bucket: {bucket_name}")
    print()

    # Get dataset ARNs
    datasets_response = personalize.list_datasets(datasetGroupArn=dataset_group_arn)
    datasets = {d["datasetType"]: d["datasetArn"] for d in datasets_response["datasets"]}
    print(f"  Datasets: {list(datasets.keys())}")

    # ── Step 1: Import Data ──
    if not args.skip_import:
        print("\n📥 Creating dataset import jobs...")

        import_jobs = []

        for dataset_type, filename in [
            ("INTERACTIONS", "interactions.csv"),
            ("ITEMS", "items.csv"),
            ("USERS", "users.csv"),
        ]:
            if dataset_type not in datasets:
                print(f"  ⚠️  No {dataset_type} dataset found, skipping")
                continue

            job_name = f"{args.stack_name}-{dataset_type.lower()}-import-{int(time.time())}"
            response = personalize.create_dataset_import_job(
                jobName=job_name,
                datasetArn=datasets[dataset_type],
                dataSource={"dataLocation": f"s3://{bucket_name}/training-data/{filename}"},
                roleArn=role_arn,
            )
            import_jobs.append(response["datasetImportJobArn"])
            print(f"  Started import: {dataset_type} → {response['datasetImportJobArn']}")

        wait_for_import_jobs(personalize, import_jobs)
    else:
        print("⏭️  Skipping data import")

    # ── Step 2: Create Solution (Model Training) ──
    if not args.skip_training:
        print("\n🧪 Creating solution (model training)...")

        solution_name = f"{args.stack_name}-user-personalization"

        # Check if solution already exists
        existing_solutions = personalize.list_solutions(datasetGroupArn=dataset_group_arn)
        existing = next((s for s in existing_solutions["solutions"] if s["name"] == solution_name), None)

        if existing:
            solution_arn = existing["solutionArn"]
            print(f"  Solution already exists: {solution_arn}")
        else:
            response = personalize.create_solution(
                name=solution_name,
                datasetGroupArn=dataset_group_arn,
                recipeArn="arn:aws:personalize:::recipe/aws-user-personalization-v2",
            )
            solution_arn = response["solutionArn"]
            print(f"  Solution created: {solution_arn}")

        # Create solution version (triggers training)
        print("  Creating solution version (this triggers model training)...")
        sv_response = personalize.create_solution_version(
            solutionArn=solution_arn,
            trainingMode="FULL",
        )
        solution_version_arn = sv_response["solutionVersionArn"]
        print(f"  Solution version: {solution_version_arn}")
        print()
        print("  ⏳ Training takes 1-2 hours. You can check status with:")
        print(f"     aws personalize describe-solution-version --solution-version-arn {solution_version_arn} --region {args.region}")
        print()
        print("  Once training is ACTIVE, create the campaign:")
        print(f"     python scripts/setup_personalize.py --region {args.region} --skip-import --skip-training")
    else:
        print("⏭️  Skipping solution training")

        # Find the latest active solution version
        solutions = personalize.list_solutions(datasetGroupArn=dataset_group_arn)
        if not solutions["solutions"]:
            print("  ✗ No solutions found. Run without --skip-training first.")
            return

        solution_arn = solutions["solutions"][0]["solutionArn"]
        versions = personalize.list_solution_versions(solutionArn=solution_arn)

        active_version = next(
            (v for v in versions["solutionVersions"] if v["status"] == "ACTIVE"),
            None,
        )

        if not active_version:
            print("  ✗ No active solution version found. Training may still be in progress.")
            for v in versions["solutionVersions"][:3]:
                print(f"    {v['solutionVersionArn']} — {v['status']}")
            return

        solution_version_arn = active_version["solutionVersionArn"]
        print(f"  Found active solution version: {solution_version_arn}")

        # ── Step 3: Create Campaign ──
        print("\n🚀 Creating campaign...")

        campaign_name = f"{args.stack_name}-recommendations"

        # Check if campaign already exists
        existing_campaigns = personalize.list_campaigns(solutionArn=solution_arn)
        existing_campaign = next(
            (c for c in existing_campaigns["campaigns"] if c["name"] == campaign_name),
            None,
        )

        if existing_campaign:
            print(f"  Campaign already exists: {existing_campaign['campaignArn']}")
            print(f"  Status: {existing_campaign['status']}")
        else:
            response = personalize.create_campaign(
                name=campaign_name,
                solutionVersionArn=solution_version_arn,
                minProvisionedTPS=1,
            )
            print(f"  Campaign created: {response['campaignArn']}")
            print("  ⏳ Campaign takes ~10 minutes to become ACTIVE")

        print("\n✅ Personalize setup complete!")


if __name__ == "__main__":
    main()
