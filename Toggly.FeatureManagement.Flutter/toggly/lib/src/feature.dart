import 'package:flutter/material.dart';
import '../toggly.dart';

enum FeatureRequirement { any, all }

class Feature extends StatefulWidget {
  const Feature({
    Key? key,
    required this.child,
    required this.featureKeys,
    this.requirement = FeatureRequirement.all,
    this.negate = false,
  }) : super(key: key);

  final List<String> featureKeys;
  final Widget child;
  final FeatureRequirement requirement;
  final bool negate;

  @override
  _FeatureState createState() => _FeatureState();
}

class _FeatureState extends State<Feature> {
  _FeatureState();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: Toggly.featureGateFuture(
        widget.featureKeys,
        requirement: widget.requirement,
        negate: widget.negate,
      ),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.done) {
          return snapshot.data == true ? widget.child : const SizedBox();
        }

        return SizedBox();
      },
    );
  }
}
