using System.Collections;
using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using Microsoft.Build.Logging.StructuredLogger;
using StructuredTask = Microsoft.Build.Logging.StructuredLogger.Task;

namespace BinlogReader;

/// <summary>
/// Exports StructuredLogger nodes into the JSON contract used by the extension.
/// </summary>
internal static class BinlogDocumentExporter
{
    /// <summary>
    /// Caches reflected public instance properties to avoid repeated lookups for every exported node.
    /// </summary>
    private static readonly ConcurrentDictionary<Type, IReadOnlyDictionary<string, PropertyInfo>> PublicPropertyCache = new();

    /// <summary>
    /// Orders detail keys so the most actionable rows stay near the top.
    /// </summary>
    private static readonly string[] PreferredDetailKeys =
    {
        "ProjectFile",
        "SourceFilePath",
        "CommandLineArguments",
        "FromAssembly",
        "ParentTarget",
        "DependsOnTargets",
        "Code",
        "File",
        "Line",
        "NodeId",
        "Id",
    };

    /// <summary>
    /// Exports the loaded build into the extension view model.
    /// </summary>
    public static BinlogDocumentModel Export(string filePath, Build build)
    {
        var counts = new NodeCounts();
        CountNodes(build, counts);

        return new BinlogDocumentModel
        {
            FileName = Path.GetFileName(filePath),
            FilePath = filePath,
            LoadedAt = DateTimeOffset.UtcNow.ToString("u", CultureInfo.InvariantCulture),
            Summary = CreateSummary(build, counts),
            RootNode = ExportRootNode(build),
        };
    }

    /// <summary>
    /// Creates the top-level summary shown in the UI.
    /// </summary>
    private static BinlogSummaryModel CreateSummary(Build build, NodeCounts counts)
    {
        bool? succeeded = TryGetBoolean(build, "Succeeded");
        string outcome = succeeded.HasValue ? (succeeded.Value ? "Succeeded" : "Failed") : (counts.Errors > 0 ? "Failed" : "Succeeded");

        return new BinlogSummaryModel
        {
            Outcome = outcome,
            DurationText = build.DurationText,
            StartTime = FormatTime(build.StartTime),
            EndTime = FormatTime(build.EndTime),
            Metrics =
            [
                CreateMetric("Projects", counts.Projects, "neutral"),
                CreateMetric("Targets", counts.Targets, "neutral"),
                CreateMetric("Tasks", counts.Tasks, "neutral"),
                CreateMetric("Warnings", counts.Warnings, counts.Warnings > 0 ? "warning" : "neutral"),
                CreateMetric("Errors", counts.Errors, counts.Errors > 0 ? "error" : "success"),
            ],
        };
    }

    /// <summary>
    /// Creates one summary metric pill.
    /// </summary>
    private static BinlogSummaryMetricModel CreateMetric(string label, int value, string tone)
    {
        return new BinlogSummaryMetricModel
        {
            Label = label,
            Value = value.ToString(CultureInfo.InvariantCulture),
            Tone = tone,
        };
    }

    /// <summary>
    /// Exports the build root in StructuredLogger order so the tree matches the IntelliJ viewer.
    /// </summary>
    private static BinlogNodeModel ExportRootNode(Build build)
    {
        return ExportNode(build);
    }

    /// <summary>
    /// Exports one StructuredLogger node recursively.
    /// </summary>
    private static BinlogNodeModel ExportNode(BaseNode node)
    {
        TimedNode? timedNode = node as TimedNode;
        string? typeName = node.TypeName;
        string title = GetTitle(node);
        string label = BuildDisplayText(node, title, timedNode);
        string? durationText = !string.IsNullOrWhiteSpace(timedNode?.DurationText) ? timedNode.DurationText : null;
        string? sourceFile = GetSourceFile(node);
        int? line = GetLine(node);

        var children = node is TreeNode treeNode && treeNode.HasChildren
            ? treeNode.Children.Select(ExportNode).ToArray()
            : Array.Empty<BinlogNodeModel>();

        return new BinlogNodeModel
        {
            Id = NodeId.Get(node) ?? Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture),
            Kind = typeName ?? node.GetType().Name,
            Title = title,
            Label = label,
            DurationText = durationText,
            StartTime = timedNode is not null ? FormatTimeOrNull(timedNode.StartTime) : null,
            EndTime = timedNode is not null ? FormatTimeOrNull(timedNode.EndTime) : null,
            SourceFile = sourceFile,
            Line = line,
            IsLowRelevance = IsLowRelevance(node),
            Details = CreateDetails(node, title, label, timedNode, sourceFile, line),
            Children = children,
            ChildCount = children.Length,
        };
    }

    /// <summary>
    /// Reads the StructuredLogger low-relevance flag when available.
    /// </summary>
    private static bool IsLowRelevance(BaseNode node)
    {
        return node is IHasRelevance relevance && relevance.IsLowRelevance;
    }

    /// <summary>
    /// Counts the node kinds needed for the summary pills.
    /// </summary>
    private static void CountNodes(BaseNode node, NodeCounts counts)
    {
        switch (node)
        {
            case Project:
                counts.Projects++;
                break;
            case Target:
                counts.Targets++;
                break;
            case StructuredTask:
                counts.Tasks++;
                break;
            case Warning:
                counts.Warnings++;
                break;
            case Error:
                counts.Errors++;
                break;
        }

        if (node is TreeNode treeNode && treeNode.HasChildren)
        {
            foreach (BaseNode child in treeNode.Children)
            {
                CountNodes(child, counts);
            }
        }
    }

    /// <summary>
    /// Creates the details rows shown in the lower pane.
    /// </summary>
    private static IReadOnlyList<BinlogDetailRowModel> CreateDetails(
        BaseNode node,
        string title,
        string label,
        TimedNode? timedNode,
        string? sourceFile,
        int? line)
    {
        string typeName = node.TypeName ?? node.GetType().Name;
        string? fullText = NormalizeOptionalText(node.GetFullText());
        var rows = new List<BinlogDetailRowModel>(PreferredDetailKeys.Length + 8);
        var seenValues = new HashSet<string>(StringComparer.Ordinal);

        AppendDetail(rows, seenValues, "Type", typeName);
        AppendDetail(rows, seenValues, "Title", title);

        if (!string.Equals(title, label, StringComparison.Ordinal))
        {
            AppendDetail(rows, seenValues, "Label", label);
        }

        if (timedNode is not null)
        {
            AppendDetail(rows, seenValues, "Start", FormatTime(timedNode.StartTime));
            AppendDetail(rows, seenValues, "End", FormatTime(timedNode.EndTime));
            AppendDetail(rows, seenValues, "Duration", timedNode.DurationText);
        }

        AppendDetail(rows, seenValues, "Source File", sourceFile);
        AppendDetail(rows, seenValues, "Line", line?.ToString(CultureInfo.InvariantCulture));

        if (!string.IsNullOrWhiteSpace(fullText) &&
            !string.Equals(fullText, title, StringComparison.Ordinal) &&
            !string.Equals(fullText, label, StringComparison.Ordinal))
        {
            AppendDetail(rows, seenValues, "Full Text", fullText);
        }

        foreach (string propertyName in PreferredDetailKeys)
        {
            string? value = ReadProperty(node, propertyName);
            AppendDetail(rows, seenValues, propertyName, value);
        }

        return rows;
    }

    /// <summary>
    /// Appends a details row when the value is non-empty and not already present.
    /// </summary>
    private static void AppendDetail(List<BinlogDetailRowModel> rows, HashSet<string> seenValues, string key, string? value)
    {
        string? normalizedValue = NormalizeOptionalText(value);
        if (normalizedValue is null || !seenValues.Add(normalizedValue))
        {
            return;
        }

        rows.Add(CreateDetail(key, normalizedValue));
    }

    /// <summary>
    /// Creates one details row.
    /// </summary>
    private static BinlogDetailRowModel CreateDetail(string key, string value)
    {
        return new BinlogDetailRowModel
        {
            Key = key,
            Value = value,
        };
    }

    /// <summary>
    /// Computes the primary node title.
    /// </summary>
    private static string GetTitle(BaseNode node)
    {
        return node switch
        {
            NameValueNode nameValueNode => nameValueNode.Name,
            TextNode textNode => textNode.Text ?? textNode.Title,
            _ => node.Title ?? node.ToString() ?? node.TypeName ?? node.GetType().Name,
        };
    }

    /// <summary>
    /// Computes the secondary text displayed in the tree using the same baseline as the IntelliJ viewer.
    /// </summary>
    private static string BuildDisplayText(BaseNode node, string title, TimedNode? timedNode)
    {
        string displayText = NormalizeOptionalText(node.ToString()) ?? title;
        if (timedNode is not null &&
            !string.IsNullOrWhiteSpace(timedNode.DurationText) &&
            !displayText.Contains(timedNode.DurationText, StringComparison.Ordinal))
        {
            return string.Concat(displayText, " [", timedNode.DurationText, "]");
        }

        return displayText;
    }

    /// <summary>
    /// Formats a timestamp for the UI.
    /// </summary>
    private static string FormatTime(DateTime value)
    {
        if (value == default)
        {
            return string.Empty;
        }

        return value.ToString("u", CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Formats a timestamp when present.
    /// </summary>
    private static string? FormatTimeOrNull(DateTime value)
    {
        return value == default ? null : FormatTime(value);
    }

    /// <summary>
    /// Gets the source file path when the node exposes one.
    /// </summary>
    private static string? GetSourceFile(BaseNode node)
    {
        return node is IHasSourceFile sourceFile && !string.IsNullOrWhiteSpace(sourceFile.SourceFilePath)
            ? sourceFile.SourceFilePath
            : null;
    }

    /// <summary>
    /// Gets the source line when the node exposes one.
    /// </summary>
    private static int? GetLine(BaseNode node)
    {
        return node is IHasLineNumber lineNumber ? lineNumber.LineNumber : null;
    }

    /// <summary>
    /// Reads a simple property through reflection.
    /// </summary>
    private static string? ReadProperty(object instance, string propertyName)
    {
        IReadOnlyDictionary<string, PropertyInfo> properties = GetPublicProperties(instance.GetType());
        if (!properties.TryGetValue(propertyName, out PropertyInfo? property))
        {
            return null;
        }

        object? value = property.GetValue(instance);
        return ConvertToString(value);
    }

    /// <summary>
    /// Converts a reflected value into text.
    /// </summary>
    private static string? ConvertToString(object? value)
    {
        if (value is null)
        {
            return null;
        }

        if (value is string text)
        {
            return NormalizeOptionalText(text);
        }

        if (value is IEnumerable enumerable and not string)
        {
            var items = enumerable.Cast<object?>().Select(ConvertToString).Where(item => !string.IsNullOrWhiteSpace(item));
            string joined = string.Join(", ", items!);
            return NormalizeOptionalText(joined);
        }

        return NormalizeOptionalText(Convert.ToString(value, CultureInfo.InvariantCulture));
    }

    /// <summary>
    /// Gets the public instance properties cached for a node type.
    /// </summary>
    private static IReadOnlyDictionary<string, PropertyInfo> GetPublicProperties(Type type)
    {
        return PublicPropertyCache.GetOrAdd(type, static currentType =>
            currentType
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Where(property => property.GetIndexParameters().Length == 0)
                .ToDictionary(property => property.Name, StringComparer.Ordinal));
    }

    /// <summary>
    /// Normalizes optional text by trimming it and collapsing empty values to null.
    /// </summary>
    private static string? NormalizeOptionalText(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    /// <summary>
    /// Reads a bool property without depending on its compile-time presence.
    /// </summary>
    private static bool? TryGetBoolean(object instance, string propertyName)
    {
        PropertyInfo? property = instance.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);
        if (property is null)
        {
            return null;
        }

        object? value = property.GetValue(instance);
        return value as bool?;
    }

    /// <summary>
    /// Stores counts needed by the summary header.
    /// </summary>
    private sealed class NodeCounts
    {
        /// <summary>
        /// Gets or sets the project count.
        /// </summary>
        public int Projects { get; set; }

        /// <summary>
        /// Gets or sets the target count.
        /// </summary>
        public int Targets { get; set; }

        /// <summary>
        /// Gets or sets the task count.
        /// </summary>
        public int Tasks { get; set; }

        /// <summary>
        /// Gets or sets the warning count.
        /// </summary>
        public int Warnings { get; set; }

        /// <summary>
        /// Gets or sets the error count.
        /// </summary>
        public int Errors { get; set; }
    }

}