using System.Text.Json.Serialization;

namespace BinlogReader;

/// <summary>
/// Represents one details row sent to the VS Code webview.
/// </summary>
internal sealed class BinlogDetailRowModel
{
    /// <summary>
    /// Gets or sets the row label.
    /// </summary>
    [JsonPropertyName("key")]
    public string Key { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the row value.
    /// </summary>
    [JsonPropertyName("value")]
    public string Value { get; set; } = string.Empty;
}

/// <summary>
/// Represents one summary metric.
/// </summary>
internal sealed class BinlogSummaryMetricModel
{
    /// <summary>
    /// Gets or sets the metric label.
    /// </summary>
    [JsonPropertyName("label")]
    public string Label { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the metric value.
    /// </summary>
    [JsonPropertyName("value")]
    public string Value { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the metric tone.
    /// </summary>
    [JsonPropertyName("tone")]
    public string? Tone { get; set; }
}

/// <summary>
/// Represents the document summary returned to the extension.
/// </summary>
internal sealed class BinlogSummaryModel
{
    /// <summary>
    /// Gets or sets the build outcome text.
    /// </summary>
    [JsonPropertyName("outcome")]
    public string Outcome { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the formatted duration.
    /// </summary>
    [JsonPropertyName("durationText")]
    public string DurationText { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the formatted start time.
    /// </summary>
    [JsonPropertyName("startTime")]
    public string StartTime { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the formatted end time.
    /// </summary>
    [JsonPropertyName("endTime")]
    public string EndTime { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the metric pills shown in the UI.
    /// </summary>
    [JsonPropertyName("metrics")]
    public IReadOnlyList<BinlogSummaryMetricModel> Metrics { get; set; } = Array.Empty<BinlogSummaryMetricModel>();
}

/// <summary>
/// Represents one exported node in the build tree.
/// </summary>
internal sealed class BinlogNodeModel
{
    /// <summary>
    /// Gets or sets the stable node identifier.
    /// </summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the StructuredLogger type name.
    /// </summary>
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the primary node title.
    /// </summary>
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the secondary label shown next to the title.
    /// </summary>
    [JsonPropertyName("label")]
    public string Label { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the formatted duration.
    /// </summary>
    [JsonPropertyName("durationText")]
    public string? DurationText { get; set; }

    /// <summary>
    /// Gets or sets the formatted start time.
    /// </summary>
    [JsonPropertyName("startTime")]
    public string? StartTime { get; set; }

    /// <summary>
    /// Gets or sets the formatted end time.
    /// </summary>
    [JsonPropertyName("endTime")]
    public string? EndTime { get; set; }

    /// <summary>
    /// Gets or sets the source file path.
    /// </summary>
    [JsonPropertyName("sourceFile")]
    public string? SourceFile { get; set; }

    /// <summary>
    /// Gets or sets the source line number.
    /// </summary>
    [JsonPropertyName("line")]
    public int? Line { get; set; }

    /// <summary>
    /// Gets or sets whether the node is low relevance.
    /// </summary>
    [JsonPropertyName("isLowRelevance")]
    public bool IsLowRelevance { get; set; }

    /// <summary>
    /// Gets or sets the details rows.
    /// </summary>
    [JsonPropertyName("details")]
    public IReadOnlyList<BinlogDetailRowModel> Details { get; set; } = Array.Empty<BinlogDetailRowModel>();

    /// <summary>
    /// Gets or sets the child nodes.
    /// </summary>
    [JsonPropertyName("children")]
    public IReadOnlyList<BinlogNodeModel> Children { get; set; } = Array.Empty<BinlogNodeModel>();

    /// <summary>
    /// Gets or sets the child count.
    /// </summary>
    [JsonPropertyName("childCount")]
    public int ChildCount { get; set; }
}

/// <summary>
/// Represents the exported document payload.
/// </summary>
internal sealed class BinlogDocumentModel
{
    /// <summary>
    /// Gets or sets the file name.
    /// </summary>
    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the full file path.
    /// </summary>
    [JsonPropertyName("filePath")]
    public string FilePath { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the timestamp when the helper exported the payload.
    /// </summary>
    [JsonPropertyName("loadedAt")]
    public string LoadedAt { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the build summary.
    /// </summary>
    [JsonPropertyName("summary")]
    public BinlogSummaryModel Summary { get; set; } = new();

    /// <summary>
    /// Gets or sets the exported build root.
    /// </summary>
    [JsonPropertyName("rootNode")]
    public BinlogNodeModel RootNode { get; set; } = new();
}

/// <summary>
/// Represents one structured helper error.
/// </summary>
internal sealed class BinlogErrorModel
{
    /// <summary>
    /// Gets or sets the error code.
    /// </summary>
    [JsonPropertyName("code")]
    public string Code { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the error message.
    /// </summary>
    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the optional error detail.
    /// </summary>
    [JsonPropertyName("detail")]
    public string? Detail { get; set; }

    /// <summary>
    /// Gets or sets standard output content.
    /// </summary>
    [JsonPropertyName("stdout")]
    public string? Stdout { get; set; }

    /// <summary>
    /// Gets or sets standard error content.
    /// </summary>
    [JsonPropertyName("stderr")]
    public string? Stderr { get; set; }
}

/// <summary>
/// Represents the helper response envelope.
/// </summary>
internal sealed class BinlogLoadResultModel
{
    /// <summary>
    /// Gets or sets the result discriminator.
    /// </summary>
    [JsonPropertyName("kind")]
    public string Kind { get; set; } = string.Empty;

    /// <summary>
    /// Gets or sets the loaded document.
    /// </summary>
    [JsonPropertyName("document")]
    public BinlogDocumentModel? Document { get; set; }

    /// <summary>
    /// Gets or sets the structured error.
    /// </summary>
    [JsonPropertyName("error")]
    public BinlogErrorModel? Error { get; set; }

    /// <summary>
    /// Creates a successful helper result.
    /// </summary>
    public static BinlogLoadResultModel Loaded(BinlogDocumentModel document)
    {
        return new BinlogLoadResultModel
        {
            Kind = "loaded",
            Document = document,
        };
    }

    /// <summary>
    /// Creates a failed helper result.
    /// </summary>
    public static BinlogLoadResultModel Failed(BinlogErrorModel error)
    {
        return new BinlogLoadResultModel
        {
            Kind = "failed",
            Error = error,
        };
    }
}