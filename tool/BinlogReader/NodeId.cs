using System.Globalization;
using System.Text;
using Microsoft.Build.Logging.StructuredLogger;

namespace BinlogReader;

/// <summary>
/// Generates stable string identifiers for StructuredLogger nodes.
/// </summary>
internal static class NodeId
{
    /// <summary>
    /// Converts a node into a stable identifier.
    /// </summary>
    public static string? Get(BaseNode node)
    {
        if (node is TimedNode timedNode)
        {
            return timedNode.Index.ToString(CultureInfo.InvariantCulture);
        }

        var ordinals = new List<int>();
        BaseNode? current = node;
        while (current is not TimedNode && current?.Parent is TreeNode parent)
        {
            int ordinal = parent.Children.IndexOf(current);
            if (ordinal < 0)
            {
                return null;
            }

            ordinals.Add(ordinal);
            current = parent;
        }

        if (current is not TimedNode anchor)
        {
            return null;
        }

        var builder = new StringBuilder();
        builder.Append(anchor.Index.ToString(CultureInfo.InvariantCulture));
        builder.Append('/');
        for (int index = ordinals.Count - 1; index >= 0; index--)
        {
            builder.Append(ordinals[index].ToString(CultureInfo.InvariantCulture));
            if (index > 0)
            {
                builder.Append('.');
            }
        }

        return builder.ToString();
    }
}