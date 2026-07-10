plugins {
    id("com.android.application")
}

android {
    namespace = "com.kingalex.kingpong"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.kingalex.kingpong"
        minSdk = 24
        targetSdk = 36
        versionCode = 4
        versionName = "1.1.0"

        // The game handles its own localization inside assets/index.html.
        resourceConfigurations += listOf("en")
    }

    buildFeatures {
        aidl = false
        buildConfig = false
        compose = false
        prefab = false
        renderScript = false
        resValues = false
        shaders = false
        viewBinding = false
    }

    buildTypes {
        debug {
            isDebuggable = true
        }
        release {
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    packaging {
        resources {
            excludes += setOf(
                "DebugProbesKt.bin",
                "META-INF/*.kotlin_module",
                "META-INF/AL2.0",
                "META-INF/LGPL2.1",
                "META-INF/LICENSE*",
                "META-INF/NOTICE*"
            )
        }
        jniLibs {
            useLegacyPackaging = false
        }
    }
}
