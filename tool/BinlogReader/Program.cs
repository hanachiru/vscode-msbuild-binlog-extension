using System.Text.Json;
using Microsoft.Build.Logging.StructuredLogger;

namespace BinlogReader;

/// <summary>
/// Provides the helper command-line entry point used by the VS Code extension.
/// </summary>
internal static class Program
{
    /// <summary>
    /// Configures JSON serialization to match the webview contract.
    /// </summary>
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false,
    };

    /// <summary>
    /// Executes the helper command and prints the JSON response.
    /// </summary>
    public static int Main(string[] args)
    {
        BinlogLoadResultModel result = ExecuteSafely(args);
        Console.Out.Write(JsonSerializer.Serialize(result, JsonOptions));
        return 0;
    }

    /// <summary>
    /// Executes the helper command and converts unexpected exceptions into a structured failure payload.
    /// </summary>
    private static BinlogLoadResultModel ExecuteSafely(string[] args)
    {
        try
        {
            return Execute(args);
        }
        catch (Exception exception)
        {
            return BinlogLoadResultModel.Failed(new BinlogErrorModel
            {
                Code = "internalError",
                Message = "The helper crashed while loading the binlog.",
                Detail = exception.Message,
                Stderr = exception.ToString(),
            });
        }
    }

    /// <summary>
    /// Executes the requested helper operation.
    /// </summary>
    private static BinlogLoadResultModel Execute(string[] args)
    {
        if (!TryGetLoadPath(args, out string filePath, out BinlogLoadResultModel? errorResult))
        {
            return errorResult!;
        }

        try
        {
            return BinlogLoadResultModel.Loaded(LoadDocument(filePath));
        }
        catch (Exception exception)
        {
            return BinlogLoadResultModel.Failed(new BinlogErrorModel
            {
                Code = "processError",
                Message = "Failed to parse the binlog file.",
                Detail = exception.Message,
                Stderr = exception.ToString(),
            });
        }
    }

    /// <summary>
    /// Validates the helper arguments and resolves the requested binlog path.
    /// </summary>
    private static bool TryGetLoadPath(string[] args, out string filePath, out BinlogLoadResultModel? errorResult)
    {
        filePath = string.Empty;
        errorResult = null;

        if (args.Length != 2 || !string.Equals(args[0], "load", StringComparison.OrdinalIgnoreCase))
        {
            errorResult = BinlogLoadResultModel.Failed(new BinlogErrorModel
            {
                Code = "internalError",
                Message = "Unsupported helper invocation.",
                Detail = "Use: BinlogReader load <path-to-binlog>",
            });
            return false;
        }

        filePath = args[1];
        if (File.Exists(filePath))
        {
            return true;
        }

        errorResult = BinlogLoadResultModel.Failed(new BinlogErrorModel
        {
            Code = "processError",
            Message = "The requested binlog file does not exist.",
            Detail = filePath,
        });
        return false;
    }

    /// <summary>
    /// Reads, analyzes, and exports the requested binlog document.
    /// </summary>
    private static BinlogDocumentModel LoadDocument(string filePath)
    {
        Build build = BinaryLog.ReadBuild(filePath);
        BuildAnalyzer.AnalyzeBuild(build);
        return BinlogDocumentExporter.Export(filePath, build);
    }
}