import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class BackendApiException implements Exception {
  const BackendApiException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => message;
}

class BackendApi {
  static const String _baseUrl = String.fromEnvironment(
    'FAMILY_CONTROL_API_URL',
    defaultValue: 'https://family-control-api.YOUR-SUBDOMAIN.workers.dev',
  );

  static Future<Map<String, dynamic>> call(
    String endpoint, {
    Map<String, dynamic> data = const <String, dynamic>{},
  }) async {
    if (_baseUrl.contains('YOUR-SUBDOMAIN')) {
      throw const BackendApiException(
        'worker_url_missing',
        'Ustaw adres Cloudflare Worker w FAMILY_CONTROL_API_URL.',
      );
    }

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      throw const BackendApiException('unauthenticated', 'Sesja logowania wygasła.');
    }
    final idToken = await user.getIdToken();
    if (idToken == null || idToken.isEmpty) {
      throw const BackendApiException('unauthenticated', 'Nie udało się pobrać tokenu Firebase.');
    }

    final baseUrl = _baseUrl.replaceFirst(RegExp(r'/+$'), '');
    final uri = Uri.parse(baseUrl + '/' + endpoint);
    final response = await http
        .post(
          uri,
          headers: <String, String>{
            'Authorization': 'Bearer ' + idToken,
            'Content-Type': 'application/json',
          },
          body: jsonEncode(data),
        )
        .timeout(const Duration(seconds: 20));

    Map<String, dynamic> decoded;
    try {
      decoded = Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    } catch (_) {
      throw BackendApiException(
        'invalid_response',
        'Backend zwrócił nieprawidłową odpowiedź (HTTP ' + response.statusCode.toString() + ').',
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300 || decoded['ok'] != true) {
      final error = decoded['error'] is Map
          ? Map<String, dynamic>.from(decoded['error'] as Map)
          : <String, dynamic>{};
      throw BackendApiException(
        error['code']?.toString() ?? 'backend_error',
        error['message']?.toString() ?? 'Operacja backendu nie powiodła się.',
      );
    }

    final result = decoded['data'];
    return result is Map ? Map<String, dynamic>.from(result) : <String, dynamic>{};
  }
}
