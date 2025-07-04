# terraform/step_functions.tf

resource "aws_sfn_state_machine" "folder_processing_state_machine" {
  name     = "${var.project_name}-FolderProcessingStateMachine"
  role_arn = aws_iam_role.sfn_exec_role.arn

  # UPDATED: This definition now exactly matches the logic from your working state machine,
  # with all hardcoded ARNs replaced by dynamic Terraform references.
  definition = jsonencode({
    Comment = "Orchestrates Bedrock KB ingestion, then fans out to summarize each study reliably."
    StartAt = "IngestFilesMap"
    States = {
      IngestFilesMap = {
        Type         = "Map",
        Comment      = "Processes each S3 file to ingest it into the Knowledge Base.",
        InputPath    = "$",
        ItemsPath    = "$.s3ItemsToProcess",
        MaxConcurrency = 1,
        ResultPath   = null,
        Parameters = {
          "s3Key.$"    = "$$.Map.Item.Value.s3Key",
          "userId.$"   = "$$.Map.Item.Value.userId",
          "folderId.$" = "$$.Map.Item.Value.folderId",
          "sessionId.$"= "$$.Map.Item.Value.sessionId",
          "fileName.$" = "$$.Map.Item.Value.fileName"
        },
        ItemProcessor = {
          ProcessorConfig = {
            Mode          = "DISTRIBUTED",
            ExecutionType = "STANDARD"
          },
          StartAt = "IngestSingleFileToKB",
          States = {
            IngestSingleFileToKB = {
              Type     = "Task",
              Resource = "arn:aws:states:::lambda:invoke",
              Parameters = {
                "FunctionName" = aws_lambda_function.ingest_file_to_bedrock_kb_lambda.arn,
                "Payload.$"    = "$"
              },
              Retry = [
                {
                  ErrorEquals     = ["States.ALL"],
                  IntervalSeconds = 15,
                  MaxAttempts     = 2,
                  BackoffRate     = 1.5
                }
              ],
              ResultPath = null,
              End        = true
            }
          }
        },
        Next = "IdentifyStudiesToSummarize",
        Catch = [
          {
            ErrorEquals = ["States.ALL"],
            Next        = "FolderProcessingFailed",
            ResultPath  = "$.errorInfo"
          }
        ]
      },
      IdentifyStudiesToSummarize = {
        Type    = "Task",
        Comment = "Scans all documents to create a to-do list of studies to summarize.",
        Resource = "arn:aws:states:::lambda:invoke",
        Parameters = {
          "FunctionName" = aws_lambda_function.identify_studies_lambda.arn,
          "Payload" = {
            "userId.$"   = "$.userId",
            "folderId.$" = "$.folderId"
          }
        },
        ResultPath = "$.studiesToProcess",
        Next       = "ProcessStudiesInParallel",
        Catch = [
          {
            ErrorEquals = ["States.ALL"],
            Next        = "FolderProcessingFailed",
            ResultPath  = "$.errorInfo"
          }
        ]
      },
      ProcessStudiesInParallel = {
        Type           = "Map",
        Comment        = "Processes 1 study at a time for maximum reliability.",
        InputPath      = "$.studiesToProcess.Payload",
        ItemsPath      = "$.studies",
        MaxConcurrency = 1,
        ResultPath     = "$.summaryRefs",
        Iterator = {
          StartAt = "SummarizeSingleStudy",
          States = {
            SummarizeSingleStudy = {
              Type       = "Task",
              Comment    = "Summarizes one single study and writes to S3.",
              Resource   = "arn:aws:states:::lambda:invoke",
              Parameters = {
                "FunctionName" = aws_lambda_function.summarize_single_study_lambda.arn,
                "Payload.$"    = "$"
              },
              ResultSelector = {
                "s3_key.$"    = "$.Payload.s3_key",
                "studyName.$" = "$.Payload.studyName"
              },
              ResultPath = "$",
              End        = true
            }
          }
        },
        Next = "AggregateResults",
        Catch = [
          {
            ErrorEquals = ["States.ALL"],
            Next        = "FolderProcessingFailed",
            ResultPath  = "$.errorInfo"
          }
        ]
      },
      AggregateResults = {
        Type       = "Task",
        Comment    = "Aggregates all summaries from S3 into one file and returns its pointer.",
        Resource   = "arn:aws:states:::lambda:invoke",
        Parameters = {
          "FunctionName" = aws_lambda_function.aggregate_results_lambda.arn,
          "Payload.$"    = "$.summaryRefs"
        },
        ResultPath = "$.aggregateOutput",
        Next       = "UpdateFolderStatusSuccess",
        Catch = [
          {
            ErrorEquals = ["States.ALL"],
            Next        = "FolderProcessingFailed",
            ResultPath  = "$.errorInfo"
          }
        ]
      },
      UpdateFolderStatusSuccess = {
        Type     = "Task",
        Comment  = "Marks the folder as successfully summarized, with a pointer to the aggregated file.",
        Resource = "arn:aws:states:::lambda:invoke",
        Parameters = {
          "FunctionName" = aws_lambda_function.update_folder_metadata_lambda.arn,
          "Payload" = {
            "userId.$"       = "$.userId",
            "folderId.$"     = "$.folderId",
            "status"         = "folder_summarized",
            "summaryCount.$" = "$.aggregateOutput.Payload.summaryCount",
            "summaryS3Key.$" = "$.aggregateOutput.Payload.aggregatedS3Key"
          }
        },
        End = true
      },
      FolderProcessingFailed = {
        Type     = "Task",
        Resource = "arn:aws:states:::lambda:invoke",
        Parameters = {
          "FunctionName" = aws_lambda_function.update_folder_metadata_lambda.arn,
          "Payload" = {
            "userId.$"       = "$.userId",
            "folderId.$"     = "$.folderId",
            "status"         = "folder_processing_failed",
            "errorDetails.$" = "$.errorInfo"
          }
        },
        End = true
      }
    }
  })

  tags = {
    Project = var.project_name
  }
}
