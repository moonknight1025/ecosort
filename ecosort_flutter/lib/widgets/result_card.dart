import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import '../models/waste_classification.dart';

/// The disposal card: what was recognised, where it goes, what it is worth,
/// whether AI vision or offline rules answered, and the CTA that writes the
/// disposal.
class ResultCard extends StatelessWidget {
  const ResultCard({
    super.key,
    required this.classification,
    required this.onDispose,
    this.busy = false,
    this.previewBytes,
  });

  final WasteClassification? classification;
  final VoidCallback onDispose;
  final bool busy;
  final List<int>? previewBytes;

  @override
  Widget build(BuildContext context) {
    final WasteClassification? item = classification;
    if (item == null) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Row(
            children: <Widget>[
              Icon(Icons.document_scanner_outlined),
              SizedBox(width: 12),
              Expanded(
                child: Text('Scan or tap a sample item to see the disposal guide.'),
              ),
            ],
          ),
        ),
      );
    }

    final Color tint = item.category.color;
    final bool fromAi = item.source == ClassificationSource.aiVision;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(height: 6, color: tint),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                // Wrap, not Row: the chips plus the bin label overflow a 390 px
                // card inside a Row.
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    _Chip(
                      label: item.category.label,
                      background: tint,
                      foreground: Colors.white,
                    ),
                    _Chip(
                      label: item.pointsLabel,
                      background: tint.withAlpha(31),
                      foreground: tint,
                    ),
                    _Chip(
                      key: const ValueKey<String>('result-source'),
                      label: fromAi ? 'AI Vision' : 'Offline rules',
                      background: fromAi ? const Color(0xFF1B5E20) : Colors.black12,
                      foreground: fromAi ? Colors.white : Colors.black87,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  item.displayName,
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                Text(
                  '${item.category.emoji} ${item.category.binColorName} bin',
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                const SizedBox(height: 8),
                Text(item.instructions),

                if (item.confidenceLabel.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 10),
                  Text(
                    item.confidenceLabel.toUpperCase(),
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.6,
                        ),
                  ),
                ],

                if (item.preparationSteps.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 8),
                  for (final String step in item.preparationSteps)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text('• ', style: TextStyle(color: tint)),
                          Expanded(child: Text(step)),
                        ],
                      ),
                    ),
                ],

                if (item.why.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 8),
                  Text(
                    item.why,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(fontStyle: FontStyle.italic),
                  ),
                ],

                if (item.visionError != null) ...<Widget>[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF4E5),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      'AI vision unavailable — ${item.visionError}. '
                      'Showing offline rules.',
                      style: const TextStyle(fontSize: 12, color: Color(0xFF7A4B00)),
                    ),
                  ),
                ],

                if (item.isFallback)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Fallback: no catalog keyword matched, so this is Dry Waste.',
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(fontStyle: FontStyle.italic),
                    ),
                  ),

                if (previewBytes != null && previewBytes!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Image.memory(
                        Uint8List.fromList(previewBytes!),
                        height: 120,
                        fit: BoxFit.cover,
                        errorBuilder: (BuildContext context, Object error,
                                StackTrace? stack) =>
                            const SizedBox.shrink(),
                      ),
                    ),
                  ),

                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: busy ? null : onDispose,
                    icon: const Icon(Icons.delete_sweep_outlined),
                    label: const Text('Toss into Virtual Bin'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({
    super.key,
    required this.label,
    required this.background,
    required this.foreground,
  });

  final String label;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: foreground,
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}
