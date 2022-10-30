import 'package:flutter/material.dart';
import 'package:toggly/toggly.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      home: const MyHomePage(title: 'Flutter Demo Home Page'),
    );
  }
}

class MyHomePage extends StatefulWidget {
  const MyHomePage({super.key, required this.title});

  final String title;

  @override
  State<MyHomePage> createState() => _MyHomePageState();
}

class _MyHomePageState extends State<MyHomePage> {
  int _counter = 0;

  void _incrementCounter() {
    setState(() {
      _counter++;
    });
  }

  @override
  void initState() {
    initToggly();
    super.initState();
  }

  void initToggly() async {
    await Toggly.init(
      apiKey: '9ff6fcc9-fd83-4dd9-8495-9f6fa980c386',
      environment: 'Production',
      identity: '2',
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            const Feature(
              featureKeys: ['Test1', 'Test3', 'on'],
              requirement: FeatureRequirement.all,
              child: Text(
                'You have pushed the button this many times:',
              ),
            ),
            const Feature(
              featureKeys: ['Test2'],
              child: Text(
                'Another random warning text ...',
                style: TextStyle(color: Colors.orangeAccent),
              ),
            ),
            Text(
              '$_counter',
              style: Theme.of(context).textTheme.headline4,
            ),
          ],
        ),
      ),
      floatingActionButton: Feature(
        featureKeys: const ['Test1'],
        child: FloatingActionButton(
          onPressed: _incrementCounter,
          tooltip: 'Increment',
          child: const Icon(Icons.add),
        ),
      ),
    );
  }
}
