import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:image_picker/image_picker.dart';
import 'package:material_ui/material_ui.dart';

import '../data/waste_catalog.dart';
import '../models/waste_category.dart';
import '../models/waste_classification.dart';
import '../services/ecosort_controller.dart';
import '../widgets/result_card.dart';
import '../widgets/virtual_bins_grid.dart';

/// Tab 1 — Scan & Bin: live browser camera, camera/upload fallbacks, six
/// one-tap samples, the disposal card and the five virtual bins.
class ScanTab extends StatefulWidget {
  const ScanTab({super.key, required this.controller});

  final EcoSortController controller;

  @override
  State<ScanTab> createState() => _ScanTabState();
}

class _ScanTabState extends State<ScanTab> {
  List<int>? _previewBytes;
  bool _picking = false;

  CameraController? _camera;
  List<CameraDescription> _cameras = const <CameraDescription>[];
  int _cameraIndex = 0;

  bool get _cameraLive => _camera?.value.isInitialized ?? false;

  void _announce(String? message) {
    if (!mounted || message == null || message.isEmpty) {
      return;
    }
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
    widget.controller.clearNotice();
  }

  void _reportResult() {
    final WasteClassification? item = widget.controller.classification;
    if (item == null) {
      _announce(widget.controller.error ?? 'Nothing recognised.');
      return;
    }
    final String provenance = item.source.label;
    _announce(
      '${item.displayName} → ${item.category.label} '
      '(+${item.points} pts, $provenance)',
    );
  }

  @override
  void dispose() {
    _camera?.dispose();
    super.dispose();
  }

  /* --- live camera ------------------------------------------------------ */

  Future<void> _startCamera() async {
    if (_picking) {
      return;
    }
    setState(() => _picking = true);
    try {
      List<CameraDescription> cameras = _cameras;
      if (cameras.isEmpty) {
        cameras = await availableCameras();
        _cameras = cameras;
      }
      if (cameras.isEmpty) {
        _announce('No camera found. Use Upload or a sample chip instead.');
        return;
      }
      final int preferred = cameras.indexWhere(
        (CameraDescription camera) => camera.lensDirection == CameraLensDirection.back,
      );
      await _openCamera(preferred >= 0 ? preferred : 0);
    } catch (error) {
      // Denied permission, missing hardware, insecure context (getUserMedia
      // needs https or localhost) and busy devices all land here.
      _announce('Camera unavailable: $error. Upload a photo or use a sample.');
    } finally {
      if (mounted) {
        setState(() => _picking = false);
      }
    }
  }

  Future<void> _openCamera(int index) async {
    await _camera?.dispose();
    final CameraController controller = CameraController(
      _cameras[index],
      ResolutionPreset.medium,
      enableAudio: false,
    );
    await controller.initialize();
    if (!mounted) {
      await controller.dispose();
      return;
    }
    setState(() {
      _camera = controller;
      _cameraIndex = index;
    });
  }

  Future<void> _switchCamera() async {
    if (_cameras.length < 2) {
      _announce('Only one camera is available on this device.');
      return;
    }
    final int next = (_cameraIndex + 1) % _cameras.length;
    setState(() => _picking = true);
    try {
      await _openCamera(next);
      _announce('Switched to ${_cameras[next].lensDirection.name} camera.');
    } catch (error) {
      _announce('Could not switch camera: $error');
    } finally {
      if (mounted) {
        setState(() => _picking = false);
      }
    }
  }

  Future<void> _stopCamera() async {
    await _camera?.dispose();
    if (!mounted) {
      return;
    }
    setState(() => _camera = null);
  }

  Future<void> _captureFrame() async {
    final CameraController? controller = _camera;
    if (controller == null || !controller.value.isInitialized) {
      return;
    }
    setState(() => _picking = true);
    try {
      final XFile shot = await controller.takePicture();
      final Uint8List bytes = await shot.readAsBytes();
      if (!mounted) {
        return;
      }
      setState(() => _previewBytes = bytes);
      await widget.controller.identifyFile(
        fileName: 'camera-capture.jpg',
        bytes: bytes,
      );
      _reportResult();
    } catch (error) {
      _announce('Capture failed: $error');
    } finally {
      if (mounted) {
        setState(() => _picking = false);
      }
    }
  }

  /* --- file paths ------------------------------------------------------- */

  Future<void> _pickImage(ImageSource source) async {
    setState(() => _picking = true);
    try {
      final ImagePicker picker = ImagePicker();
      final XFile? file = await picker.pickImage(source: source);
      if (file == null) {
        return;
      }
      final Uint8List bytes = await file.readAsBytes();
      if (!mounted) {
        return;
      }
      setState(() => _previewBytes = bytes);
      await widget.controller.identifyFile(fileName: file.name, bytes: bytes);
      _reportResult();
    } catch (error) {
      _announce('Image picking unavailable here: $error');
    } finally {
      if (mounted) {
        setState(() => _picking = false);
      }
    }
  }

  Future<void> _pickSample(String keyword) async {
    await widget.controller.identifyPreset(keyword);
    if (!mounted) {
      return;
    }
    setState(() => _previewBytes = null);
    _reportResult();
  }

  /* --- build ------------------------------------------------------------ */

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
          'Use the camera, upload a photo, or tap a sample item.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                if (_cameraLive)
                  AspectRatio(
                    aspectRatio: 3 / 4,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: CameraPreview(_camera!),
                    ),
                  )
                else if (_previewBytes != null)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.memory(
                      Uint8List.fromList(_previewBytes!),
                      height: 200,
                      fit: BoxFit.cover,
                    ),
                  ),
                if (_cameraLive) ...<Widget>[
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _picking ? null : _captureFrame,
                      icon: const Icon(Icons.camera_alt),
                      label: const Text('Capture Photo'),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _picking ? null : _switchCamera,
                          icon: const Icon(Icons.cameraswitch_outlined),
                          label: const Text('Switch'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _picking ? null : _stopCamera,
                          icon: const Icon(Icons.videocam_off_outlined),
                          label: const Text('Stop'),
                        ),
                      ),
                    ],
                  ),
                ] else ...<Widget>[
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _picking ? null : _startCamera,
                      icon: const Icon(Icons.videocam_outlined),
                      label: Text(
                        _picking ? 'Opening camera…' : 'Start live camera',
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _picking
                              ? null
                              : () => _pickImage(ImageSource.camera),
                          icon: const Icon(Icons.photo_camera_outlined),
                          label: const Text('Camera'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _picking
                              ? null
                              : () => _pickImage(ImageSource.gallery),
                          icon: const Icon(Icons.photo_library_outlined),
                          label: const Text('Upload'),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 4),
                Text(
                  'Permission denied, no camera, or a non-secure origin? '
                  'The buttons above still work.',
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
                onPressed: controller.busy ? null : () => _pickSample(sample.keyword),
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
