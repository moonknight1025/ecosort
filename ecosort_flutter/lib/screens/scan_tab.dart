import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';
import 'package:image_picker/image_picker.dart';

import '../data/waste_catalog.dart';
import '../models/waste_category.dart';
import '../services/ecosort_controller.dart';
import '../widgets/result_card.dart';
import '../widgets/virtual_bins_grid.dart';

/// Tab 1 — Scan & Bin: image pick, six one-tap samples, result card, and the
/// five virtual bins.
class ScanTab extends StatefulWidget {
  const ScanTab({super.key, required this.controller});

  final EcoSortController controller;

  @override
  State<ScanTab> createState() => _ScanTabState();
}

class _ScanTabState extends State<ScanTab> {
  List<int>? _previewBytes;
  bool _picking = false;

  void _announce(String? message) {
    if (!mounted || message == null || message.isEmpty) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
    widget.controller.clearNotice();
  }

  Future<void> _pickImage() async {
    setState(() => _picking = true);
    try {
      final ImagePicker picker = ImagePicker();
      final XFile? file = await picker.pickImage(source: ImageSource.gallery);
      if (file == null) {
        return;
      }
      final Uint8List bytes = await file.readAsBytes();
      if (!mounted) {
        return;
      }
      setState(() => _previewBytes = bytes);
      await widget.controller
          .identifyFile(fileName: file.name, bytes: bytes);
      _announce(widget.controller.notice ?? widget.controller.error);
    } catch (error) {
      // The picker plugin is absent in widget tests and on platforms without a
      // gallery; tell the user instead of throwing into the void.
      _announce('Image picking unavailable here: $error');
    } finally {
      if (mounted) {
        setState(() => _picking = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final EcoSortController controller = widget.controller;
    final Map<WasteCategory, int> binCounts = controller.snapshot?.binCounts ??
        <WasteCategory, int>{
          for (final WasteCategory category in WasteCategory.values) category: 0,
        };

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: <Widget>[
        Text(
          'Scan & Bin',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        Text(
          'Pick an item to learn where it goes and what it is worth.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: <Widget>[
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: (_picking || controller.busy) ? null : _pickImage,
                    icon: const Icon(Icons.add_a_photo_outlined),
                    label: Text(
                      _picking ? 'Opening picker…' : 'Upload a waste photo',
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'On web the file name drives classification (offline, deterministic).',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: <Widget>[
            for (final ({String label, String keyword}) sample in presetSamples)
              ActionChip(
                label: Text(sample.label),
                onPressed: controller.busy
                    ? null
                    : () async {
                        await controller.identifyPreset(sample.keyword);
                        if (!mounted) {
                          return;
                        }
                        setState(() => _previewBytes = null);
                        _announce(controller.notice ?? controller.error);
                      },
              ),
          ],
        ),
        const SizedBox(height: 16),
        ResultCard(
          classification: controller.classification,
          busy: controller.busy,
          previewBytes: _previewBytes,
          onDispose: () async {
            final bool ok = await controller.disposeCurrent();
            if (!mounted) {
              return;
            }
            setState(() => _previewBytes = null);
            _announce(
              ok ? controller.notice : (controller.error ?? 'Disposal failed'),
            );
          },
        ),
        const SizedBox(height: 20),
        Text(
          'Virtual Recycling Bins',
          style: Theme.of(context)
              .textTheme
              .titleSmall
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        VirtualBinsGrid(counts: binCounts),
      ],
    );
  }
}
