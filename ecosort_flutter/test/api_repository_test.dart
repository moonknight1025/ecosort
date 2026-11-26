import 'dart:convert';

import 'package:ecosort_flutter/models/waste_category.dart';
import 'package:ecosort_flutter/models/waste_classification.dart';
import 'package:ecosort_flutter/services/api_repository.dart';
import 'package:ecosort_flutter/services/ecosort_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Contract tests for the Flask client: they pin the response mapping (AI vs
/// rules provenance, confidence, preparation steps) and the 429 translation,
/// without needing a live server.
void main() {
  final Uri baseUrl = Uri.parse('http://127.0.0.1:5000');

  test('parses an AI vision response including steps and confidence', () {
    final WasteClassification result = WasteClassification.fromApiJson(
      <String, dynamic>{
        'display_name': 'Crushed PET bottle',
        'category': 'Recyclable Waste',
        'instructions': 'Rinse and flatten',
        'points': 15,
        'fallback': false,
        'matched_keyword': null,
        'source': 'ai_vision',
        'confidence': 0.91,
        'preparation_steps': <String>['Empty and rinse', 'Remove the cap'],
        'why': 'PET is a high-value rigid plastic.',
        'ai_model': 'gpt-4o-mini',
        'vision_error': null,
      },
    );

    expect(result.source, ClassificationSource.aiVision);
    expect(result.source.label, 'AI Vision');
    expect(result.category, WasteCategory.recyclable);
    expect(result.confidence, 0.91);
    expect(result.confidenceLabel, 'Confidence 91%');
    expect(result.preparationSteps.length, 2);
    expect(result.points, 15);
  });

  test('parses a rules fallback and keeps the reason', () {
    final WasteClassification result = WasteClassification.fromApiJson(
      <String, dynamic>{
        'display_name': 'Unrecognized Item',
        'category': 'Dry Waste',
        'instructions': 'Use the gray bin',
        'points': 10,
        'fallback': true,
        'source': 'rules',
        'confidence': null,
        'preparation_steps': <String>[],
        'vision_error': 'no image supplied; filename and preset rules used',
      },
    );

    expect(result.source, ClassificationSource.rules);
    expect(result.isFallback, isTrue);
    expect(result.confidenceLabel, isEmpty);
    expect(result.visionError, contains('no image supplied'));
  });

  test('identify sends the image and returns the parsed classification',
      () async {
    late http.Request captured;
    final MockClient mock = MockClient((http.Request request) async {
      captured = request;
      return http.Response(
        jsonEncode(<String, dynamic>{
          'display_name': 'Used Battery',
          'category': 'Hazardous Waste',
          'instructions': 'Tape the terminals',
          'points': 25,
          'fallback': false,
          'source': 'ai_vision',
          'confidence': 0.88,
          'preparation_steps': <String>['Tape the terminals', 'Use the red bin'],
          'why': 'Li-ion cells are hazardous.',
        }),
        200,
        headers: <String, String>{'content-type': 'application/json'},
      );
    });
    final ApiRepository repository = ApiRepository(baseUrl: baseUrl, client: mock);

    final WasteClassification result = await repository.identify(
      imageBytes: <int>[1, 2, 3, 255],
      imageName: 'camera-capture.jpg',
    );

    expect(captured.url.path, '/api/identify');
    expect(captured.headers['content-type'], contains('multipart/form-data'));
    // The multipart body carries raw JPEG bytes, so it is not valid UTF-8.
    expect(String.fromCharCodes(captured.bodyBytes), contains('camera-capture.jpg'));
    expect(result.category, WasteCategory.hazardous);
    expect(result.source, ClassificationSource.aiVision);
    expect(result.points, 25);
  });

  test('a 429 becomes a readable backend error with the retry hint', () async {
    final MockClient mock = MockClient((http.Request request) async {
      return http.Response(
        jsonEncode(<String, dynamic>{
          'error': 'Too many requests. Try again in 42s (limit 8/minute).',
          'retry_after': 42,
        }),
        429,
        headers: <String, String>{'content-type': 'application/json', 'retry-after': '42'},
      );
    });
    final ApiRepository repository = ApiRepository(baseUrl: baseUrl, client: mock);

    await expectLater(
      repository.dispose(
        username: 'You',
        item: const WasteClassification(
          displayName: 'Plastic Bottle',
          category: WasteCategory.recyclable,
          instructions: 'Rinse',
          points: 15,
          isFallback: false,
        ),
      ),
      throwsA(
        isA<EcoSortBackendException>().having(
          (EcoSortBackendException error) => error.message,
          'message',
          allOf(contains('Too many requests'), contains('retry in 42s')),
        ),
      ),
    );
  });
}
