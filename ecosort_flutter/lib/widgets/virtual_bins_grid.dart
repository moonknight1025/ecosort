import 'package:material_ui/material_ui.dart';

import '../models/waste_category.dart';

/// The five virtual bins with live counters. The whole tile pulses once when its
/// count increases (`TweenAnimationBuilder` keyed on the count), which is the
/// visual feedback asked for when an item is tossed in.
class VirtualBinsGrid extends StatelessWidget {
  const VirtualBinsGrid({super.key, required this.counts});

  final Map<WasteCategory, int> counts;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = constraints.maxWidth < 390 ? 3 : 5;
        const double spacing = 8;
        final double tileWidth =
            (constraints.maxWidth - spacing * (columns - 1)) / columns;
        return Wrap(
          spacing: spacing,
          runSpacing: spacing,
          children: <Widget>[
            for (final WasteCategory category in WasteCategory.values)
              SizedBox(
                width: tileWidth,
                child: _BinTile(
                  category: category,
                  count: counts[category] ?? 0,
                ),
              ),
          ],
        );
      },
    );
  }
}

class _BinTile extends StatelessWidget {
  const _BinTile({required this.category, required this.count});

  final WasteCategory category;
  final int count;

  @override
  Widget build(BuildContext context) {
    final Widget tile = Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            height: 4,
            width: 28,
            decoration: BoxDecoration(
              color: category.color,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const SizedBox(height: 8),
          Text(category.emoji, style: const TextStyle(fontSize: 16)),
          const SizedBox(height: 2),
          Text(
            '$count',
            key: ValueKey<String>('bin-count-${category.name}'),
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: category.color,
            ),
          ),
          Text(
            category.shortLabel,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.labelSmall,
          ),
        ],
      ),
    );

    return TweenAnimationBuilder<double>(
      key: ValueKey<String>('pulse-${category.name}-$count'),
      tween: Tween<double>(begin: 1.10, end: 1.0),
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOut,
      builder: (BuildContext context, double scale, Widget? child) {
        return Transform.scale(scale: scale, child: child);
      },
      child: tile,
    );
  }
}
